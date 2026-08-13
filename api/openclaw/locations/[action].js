const handlers = {
  intake: require('../../../lib/api-openclaw/intake'),
  confirm: require('../../../lib/api-openclaw/confirm')
};

module.exports = async function handler(req, res) {
  const action = String(req.query?.action || '');
  const routeHandler = handlers[action];
  if (!routeHandler) return res.status(404).json({ error: '接口不存在' });
  return routeHandler(req, res);
};

module.exports.handlers = handlers;
