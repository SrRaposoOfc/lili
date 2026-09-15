const BASE = 'https://discord.com/api/v10';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ALERT_CHANNEL_ID = process.env.ALERT_CHANNEL_ID || '1549493182117584966';
const BOT_ID = process.env.CLIENT_ID;

const THROTTLE_MS = 1000;

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

function embedFor(count, lastTs) {
  return [{
    title: 'Lilith Goth',
    description: 'Contador ao vivo de visitas do site.',
    fields: [
      { name: 'Visitas', value: String(count), inline: true },
      { name: 'Último registro', value: lastTs ? `<t:${Math.floor(lastTs / 1000)}:R>` : 'nunca', inline: true },
    ],
    color: 13223378,
    footer: { text: 'Alimentado automaticamente' },
  }];
}

function parseState(message) {
  let count = 0;
  let lastTs = 0;
  for (const embed of message.embeds || []) {
    for (const field of embed.fields || []) {
      if (field.name === 'Visitas') {
        count = parseInt(field.value.replace(/\D/g, ''), 10) || 0;
      } else if (field.name === 'Último registro') {
        const m = field.value.match(/<t:(\d+)/);
        if (m) lastTs = parseInt(m[1], 10) * 1000;
      }
    }
  }
  return { count, lastTs };
}

async function readOrCreate() {
  const list = await discordFetch(`/channels/${CHANNEL_ID}/messages?limit=10`);
  if (list.ok) {
    const messages = await list.json();
    const mine = messages.find(
      (m) =>
        m.author &&
        m.author.id === BOT_ID &&
        (m.embeds || []).some((e) => (e.fields || []).some((f) => f.name === 'Visitas'))
    );
    if (mine) return mine;
  }
  const created = await discordFetch(`/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify({ embeds: embedFor(0, 0) }),
  });
  if (!created.ok) throw new Error('create message ' + created.status);
  return created.json();
}

async function patchState(message, state) {
  const res = await discordFetch(`/channels/${CHANNEL_ID}/messages/${message.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ embeds: embedFor(state.count, state.lastTs) }),
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
    return { count: lastCount, lastTs: lastRegAt, degraded: true };
  }
}

async function registerVisit() {
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
  const next = { count: lastCount + 1, lastTs: now };
  const applied = await patchState(message, next);
  if (applied) {
    lastCount = next.count;
    lastRegAt = now;
  }
  return { count: next.count, registered: applied, applied };
}

function truncate(value, max) {
  return String(value || '').slice(0, max) || '?';
}

async function sendAccessInfo(info) {
  const fields = [
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
    { name: 'URL', value: truncate(info.url, 400), inline: false },
  ];
  try {
    const res = await discordFetch(`/channels/${ALERT_CHANNEL_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        embeds: [{
          title: 'Novo acesso',
          color: 13223378,
          description: 'Alguém entrou no site',
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

module.exports = { getState, registerVisit, sendAccessInfo };