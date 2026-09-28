const { getState } = require('./_discord.js');

module.exports = async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  let result;
  try {
    const state = await getState();
    result = { count: state.count, lastTs: state.lastTs };
  } catch (e) {
    result = { count: 0, lastTs: 0, error: String(e.message) };
  }
  res.status(200).json(result);
};