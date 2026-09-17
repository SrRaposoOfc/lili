const BASE = 'https://discord.com/api/v10';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID || '1549493182117584966';
const BOT_ID = process.env.CLIENT_ID;

const THROTTLE_MS = 1000;
const V2_FLAG = 1 << 15;
const EPHEMERAL = 64;
const RESET_CUSTOM_ID = 'reset_counters';

let lastRegAt = 0;
let lastCount = 0;

async function discordFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${TOKEN}`,
      ...(options.headers || {}),
    },
  });
  return res;
}

function statsText(count, instagram, discord, outros, lastTs) {
  return [
    `**Visitas:** ${count}`,
    `**Instagram:** ${instagram}`,
    `**Discord:** ${discord}`,
    `**Outros:** ${outros}`,
    `**Último registro:** ${lastTs ? `<t:${Math.floor(lastTs / 1000)}:R>` : 'nunca'}`,
  ].join('\n');
}

function counterComponents(state) {
  return [
    {
      type: 17,
      accent_color: 3937121,
      components: [
        { type: 10, content: '# 📊 Métricas de Visitas' },
        { type: 14 },
        { type: 10, content: statsText(state.count, state.instagram, state.discord, state.outros, state.lastTs) },
        {
          type: 1,
          components: [
            { type: 2, style: 2, custom_id: RESET_CUSTOM_ID, label: 'Resetar contador' },
          ],
        },
      ],
    },
  ];
}

function parseState(message) {
  let count = 0;
  let lastTs = 0;
  let instagram = 0;
  let discord = 0;
  let outros = 0;

  for (const embed of message.embeds || []) {
    for (const field of embed.fields || []) {
      if (field.name === 'Visitas') {
        count = parseInt(field.value.replace(/\D/g, ''), 10) || 0;
      } else if (field.name === 'Instagram') {
        instagram = parseInt(field.value.replace(/\D/g, ''), 10) || 0;
      } else if (field.name === 'Discord') {
        discord = parseInt(field.value.replace(/\D/g, ''), 10) || 0;
      } else if (field.name === 'Outros') {
        outros = parseInt(field.value.replace(/\D/g, ''), 10) || 0;
      } else if (field.name === 'Último registro') {
        const m = field.value.match(/<t:(\d+)/);
        if (m) lastTs = parseInt(m[1], 10) * 1000;
      }
    }
  }

  const texts = [];
  const walk = (comps) => {
    for (const c of comps || []) {
      if (c.type === 10) texts.push(c.content);
      else if (c.components) walk(c.components);
    }
  };
  walk(message.components || []);
  const text = texts.join('\n');
  if (text) {
    const num = (label) => {
      const m = text.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(\\d+)`));
      return m ? (parseInt(m[1], 10) || 0) : 0;
    };
    count = num('Visitas');
    instagram = num('Instagram');
    discord = num('Discord');
    outros = num('Outros');
    const m = text.match(/\*\*Último registro:\*\*\s*<t:(\d+)(?::R|:t|:f|:F|:d|:D)>/);
    if (m) lastTs = parseInt(m[1], 10) * 1000;
  }

  return { count, lastTs, instagram, discord, outros };
}

function hasCustomId(comps, customId) {
  for (const c of comps || []) {
    if (c.custom_id === customId) return true;
    if (c.components && hasCustomId(c.components, customId)) return true;
  }
  return false;
}

function isLegacyCounter(m) {
  return (
    m.author &&
    m.author.id === BOT_ID &&
    (m.embeds || []).some((e) => (e.fields || []).some((f) => f.name === 'Visitas'))
  );
}

async function readOrCreate() {
  const list = await discordFetch(`/channels/${CHANNEL_ID}/messages?limit=20`);
  if (!list.ok) {
    throw new Error('list ' + list.status);
  }
  const messages = await list.json();
  const v2s = messages.filter((m) => m.author && m.author.id === BOT_ID && hasCustomId(m.components, RESET_CUSTOM_ID));
  for (let i = 1; i < v2s.length; i++) {
    try {
      await discordFetch(`/channels/${CHANNEL_ID}/messages/${v2s[i].id}`, { method: 'DELETE' });
    } catch (e) {}
  }
  if (v2s.length) return v2s[0];

  for (const legacy of messages.filter(isLegacyCounter)) {
    try {
      await discordFetch(`/channels/${CHANNEL_ID}/messages/${legacy.id}`, { method: 'DELETE' });
    } catch (e) {}
  }
  const created = await discordFetch(`/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({ flags: V2_FLAG, components: counterComponents({ count: 0, lastTs: 0, instagram: 0, discord: 0, outros: 0 }) }),
  });
  if (!created.ok) throw new Error('create message ' + created.status);
  return created.json();
}

async function patchState(message, state) {
  const res = await discordFetch(`/channels/${CHANNEL_ID}/messages/${message.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ components: counterComponents(state) }),
  });
  if (res.status === 429) return false;
  if (!res.ok) throw new Error('patch ' + res.status);
  return true;
}

async function getState() {
  try {
    const message = await readOrCreate();
    const state = parseState(message);
    lastCount = state.count;
    lastRegAt = state.lastTs;
    return state;
  } catch (e) {
    return { count: lastCount, lastTs: lastRegAt, instagram: 0, discord: 0, outros: 0, degraded: true };
  }
}

async function registerVisit(origem) {
  const now = Date.now();
  if (now - lastRegAt < THROTTLE_MS) {
    return { count: lastCount, registered: false };
  }
  let message;
  try {
    message = await readOrCreate();
  } catch (e) {
    return { count: lastCount, registered: false, degraded: true };
  }
  const state = parseState(message);
  lastCount = state.count;
  if (now - Math.max(state.lastTs, lastRegAt) < THROTTLE_MS) {
    return { count: lastCount, registered: false };
  }
  const isInsta = origem === 'instagram';
  const isDiscord = origem === 'discord';
  const next = {
    count: lastCount + 1,
    lastTs: now,
    instagram: state.instagram + (isInsta ? 1 : 0),
    discord: state.discord + (isDiscord ? 1 : 0),
    outros: state.outros + (isInsta || isDiscord ? 0 : 1),
  };
  const applied = await patchState(message, next);
  if (applied) {
    lastCount = next.count;
    lastRegAt = now;
  }
  return { count: next.count, registered: applied, applied, instagram: next.instagram, discord: next.discord, outros: next.outros };
}

async function resetCounters() {
  let message;
  try {
    message = await readOrCreate();
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
  const state = parseState(message);
  const next = { count: 0, lastTs: state.lastTs, instagram: 0, discord: 0, outros: 0 };
  const applied = await patchState(message, next);
  if (applied) {
    lastCount = 0;
    lastRegAt = state.lastTs;
  }
  return { ok: applied, count: 0, instagram: 0, discord: 0, outros: 0 };
}

function truncate(value, max) {
  return String(value || '').slice(0, max) || '?';
}

async function sendAccessInfo(info) {
  const isInsta = info.origem === 'instagram';
  const isDiscord = info.origem === 'discord';
  const origemLabel = isInsta ? 'Instagram (bio)' : (isDiscord ? 'Discord' : 'Navegador');
  const fields = [
    { name: 'Origem', value: origemLabel, inline: true },
    { name: 'IP', value: truncate(info.ip, 60), inline: true },
    { name: 'Hora', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
    { name: 'Navegador', value: truncate(info.ua, 1024), inline: false },
    { name: 'Plataforma', value: truncate(info.platform, 120), inline: true },
    { name: 'Idioma', value: truncate(info.language, 60), inline: true },
    { name: 'Fuso horário', value: truncate(info.timezone, 80), inline: true },
    { name: 'Tela', value: truncate(info.screen, 60), inline: true },
    { name: 'Cores/DPR', value: truncate(info.screenInfo, 60), inline: true },
    { name: 'CPU/GPU info', value: truncate(info.hardware, 160), inline: true },
    { name: 'Referer', value: truncate(info.referer, 400), inline: false },
  ];
  try {
    const res = await discordFetch(`/channels/${ALERT_CHANNEL_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        embeds: [{
          title: isInsta ? 'Novo acesso • Instagram' : (isDiscord ? 'Novo acesso • Discord' : 'Novo acesso'),
          color: isInsta ? 14976095 : (isDiscord ? 5793266 : 13223378),
          description: isInsta ? 'Acesso pelo link da bio do Instagram' : (isDiscord ? 'Acesso pelo link do Discord' : 'Alguém entrou no site'),
          fields,
          footer: { text: 'xleav.lol' },
        }],
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

module.exports = {
  getState,
  registerVisit,
  resetCounters,
  sendAccessInfo,
  discordFetch,
  RESET_CUSTOM_ID,
  V2_FLAG,
  EPHEMERAL,
};