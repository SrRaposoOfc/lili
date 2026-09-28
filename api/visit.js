const { registerVisit, sendAccessInfo } = require('./_discord.js');

const ALLOWED_HOSTS = ['xleav.lol', 'localhost', '127.0.0.1'];

const IP_WINDOW_MS = 60 * 1000;
const IP_DAY_MS = 24 * 60 * 60 * 1000;
const IP_DAY_CAP = 48;
const IP_MAP_CAP = 6000;
const GLOBAL_ALERT_MS = 1500;
const MAX_BODY_BYTES = 16 * 1024;

const ipMap = new Map();
let globalLastAlertAt = 0;

function lastOf(value) {
  if (!value) return '';
  return String(value).split(',').map((p) => p.trim()).filter(Boolean).pop() || '';
}

function isAllowedHost(req) {
  const h = req.headers || {};
  const host = (lastOf(h['x-forwarded-host']) || h['host'] || '')
    .split(':')[0]
    .trim()
    .toLowerCase();
  return ALLOWED_HOSTS.includes(host) || host.endsWith('.xleav.lol');
}

function readBody(req) {
  return new Promise((resolve) => {
    if (!req || typeof req.on !== 'function') {
      resolve('');
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY_BYTES) chunks.push(c);
      else overflow = true;
    });
    req.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), overflow }));
    req.on('error', () => resolve({ text: '', overflow: false }));
  });
}

function getIp(req) {
  const h = req.headers || {};
  const fwd = lastOf(h['x-forwarded-for']);
  return String(fwd || h['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'desconhecido')
    .replace(/^::ffff:/, '')
    .replace(/\[|\]/g, '');
}

function rateLimit(ip) {
  const now = Date.now();
  const dayKey = Math.floor(now / IP_DAY_MS);

  let entry = ipMap.get(ip);
  if (!entry) {
    entry = { lastAt: 0, dayKey, dayCount: 0 };
    if (ipMap.size >= IP_MAP_CAP) {
      ipMap.delete(ipMap.keys().next().value);
    }
    ipMap.set(ip, entry);
  }

  if (entry.dayKey !== dayKey) {
    entry.dayKey = dayKey;
    entry.dayCount = 0;
  }

  if (now - entry.lastAt < IP_WINDOW_MS) {
    return false;
  }
  if (entry.dayCount >= IP_DAY_CAP) {
    return false;
  }

  entry.lastAt = now;
  entry.dayCount += 1;
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  let result;
  try {
    if (!isAllowedHost(req)) {
      result = { count: 0, registered: false, ignored: true };
      res.status(200).json(result);
      return;
    }

    const ip = getIp(req);
    if (!rateLimit(ip)) {
      result = { count: 0, registered: false, blocked: true };
      res.status(200).json(result);
      return;
    }

    const raw = await readBody(req);
    if (raw.overflow) {
      res.status(413).json({ error: 'body too large' });
      return;
    }
    let browser = {};
    try {
      browser = JSON.parse(raw.text || '{}');
    } catch (e) {
      browser = {};
    }

    const h = req.headers || {};
    const origem = browser.utm_source === 'instagram' ? 'instagram'
      : browser.utm_source === 'discord' ? 'discord'
      : 'navegador';
    const info = {
      ip,
      origem,
      ua: String(browser.ua || h['user-agent'] || '').slice(0, 512),
      platform: String(browser.platform || '').slice(0, 120),
      language: String(browser.language || '').slice(0, 60),
      timezone: String(browser.timezone || '').slice(0, 80),
      screen: String(browser.screen || '').slice(0, 60),
      screenInfo: String(browser.screenInfo || '').slice(0, 60),
      hardware: String(browser.hardware || '').slice(0, 160),
      referer: String(browser.referer || h.referer || '').slice(0, 400),
      url: String(browser.url || '').slice(0, 400),
    };

    const now = Date.now();
    const sendAlert = now - globalLastAlertAt >= GLOBAL_ALERT_MS;

    await Promise.allSettled([
      registerVisit(origem),
      sendAlert ? sendAccessInfo(info) : Promise.resolve(false),
    ]).then(([reg]) => {
      result = reg.value || { count: 0, registered: false };
    });

    if (sendAlert) globalLastAlertAt = now;
  } catch (e) {
    result = { count: 0, registered: false, error: String(e.message) };
  }
  res.status(200).json(result);
};