const { registerVisit, sendAccessInfo } = require('./_discord.js');

function readBody(req) {
  return new Promise((resolve) => {
    if (!req || typeof req.on !== 'function') {
      resolve('');
      return;
    }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

function getIp(req) {
  const h = req.headers || {};
  const fwd = String(h['x-forwarded-for'] || '');
  return (fwd.split(',')[0] || '').trim()
    || h['x-real-ip']
    || (req.socket && req.socket.remoteAddress)
    || 'desconhecido';
}

module.exports = async function handler(req, res) {
  let result;
  try {
    const raw = await readBody(req);
    let browser = {};
    try {
      browser = JSON.parse(raw || '{}');
    } catch (e) {
      browser = {};
    }

    const h = req.headers || {};
    const info = {
      ip: getIp(req),
      ua: browser.ua || h['user-agent'],
      platform: browser.platform,
      language: browser.language,
      timezone: browser.timezone,
      screen: browser.screen,
      screenInfo: browser.screenInfo,
      hardware: browser.hardware,
      referer: browser.referer || h.referer,
      url: browser.url,
    };

    await Promise.allSettled([
      registerVisit(),
      sendAccessInfo(info),
    ]).then(([reg]) => {
      result = reg.value || { count: 0, registered: false };
    });
  } catch (e) {
    result = { count: 0, registered: false, error: String(e.message) };
  }
  res.status(200).json(result);
};