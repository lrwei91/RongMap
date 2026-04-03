const { DEFAULT_CITY, normalizePreferredCity, searchPlaces } = require('../lib/amap');

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const { keywords, city } = req.body;

    if (!keywords) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }

    try {
      const result = await searchPlaces({
        keywords,
        city: normalizePreferredCity(city || DEFAULT_CITY)
      });

      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || '搜索请求失败' });
    }
  }

  return res.status(405).json({ error: '方法不允许' });
};
