const { getRequestIdentity } = require('../server-supabase');
const { collectResearch, enrichResearch, generateGuide } = require('../travel-guide');
const { methodNotAllowed } = require('./_response');
function createHandler(auth = getRequestIdentity, collect = collectResearch, generate = generateGuide, enrich = enrichResearch) {
  return async (req, res) => {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const identity = await auth(req);
      const body = req.body || {};
      if (body.action === 'collect') return res.status(200).json(await collect(body, identity));
      if (body.action === 'source') return res.status(200).json(await enrich(body, identity));
      if (body.action === 'generate') return res.status(200).json(await generate(body, identity));
      return res.status(400).json({ error: '不支持的攻略操作' });
    } catch (error) {
      // 不返回上游原始异常或请求参数；地图凭据只留在服务端。
      return res.status(error.status || 500).json({ error: error.status ? error.message : '旅行攻略服务暂时不可用' });
    }
  };
}
module.exports = createHandler();
module.exports.createHandler = createHandler;
