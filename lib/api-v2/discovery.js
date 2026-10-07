const { getRequestIdentity } = require('../server-supabase');
const { discoverRestaurants } = require('../restaurant-discovery');

function createHandler(identity = getRequestIdentity, discover = discoverRestaurants) {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: '方法不允许' });
    }
    try {
      await identity(req);
      const result = await discover(req.body?.bounds);
      return res.status(200).json(result);
    } catch (error) {
      const status = error.status || 500;
      return res.status(status).json({ error: status >= 500 ? '餐饮搜索暂时不可用，请稍后重试' : error.message });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
