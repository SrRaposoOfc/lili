const { registerVisit } = require('./_discord.js');

module.exports = async function handler(req, res) {
  let result;
  try {
    result = await registerVisit();
  } catch (e) {
    result = { count: 0, registered: false, error: String(e.message) };
  }
  res.status(200).json(result);
};