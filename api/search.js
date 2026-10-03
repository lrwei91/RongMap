const { DEFAULT_CITY, normalizePreferredCity, searchPlaces } = require('../lib/amap');
const { getRequestIdentity } = require('../lib/server-supabase');

// 地点搜索会消耗服务端高德配额，因此必须登录；同时把 city 收敛到允许的城市，避免匿名接口变成任意城市的配额代理。
const ALLOWED_CITIES = new Set([DEFAULT_CITY]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '方法不允许' });
  }
  try {
    await getRequestIdentity(req);
    const { keywords, city } = req.body || {};
    if (!keywords) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }
    const preferred = normalizePreferredCity(city || DEFAULT_CITY);
    if (!ALLOWED_CITIES.has(preferred)) {
      return res.status(400).json({ error: `当前仅支持搜索${DEFAULT_CITY}` });
    }

    const result = await searchPlaces({ keywords, city: preferred });
    return res.status(200).json(result);
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: status >= 500 ? '搜索服务暂时不可用' : err.message });
  }
};
