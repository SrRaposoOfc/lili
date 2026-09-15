const BASE = 'https://discord.com/api/v10';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
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
  const list = await discordFetch(`/channels/${CHANNEL_ID}/messages?limit=5`);
  if (list.ok) {
    const messages = await list.json();
    const mine = messages.find((m) => m.author && m.author.id === BOT_ID && (m.embeds || []).length > 0);
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

module.exports = { getState, registerVisit };