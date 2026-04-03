const { geocodeAddress } = require('../lib/amap');

module.exports = async function handler(req, res) {
  if (req.method === 'POST') {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: '地址不能为空' });
    }

    try {
      const result = await geocodeAddress(address);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message || '地理编码请求失败' });
    }
  }

  return res.status(405).json({ error: '方法不允许' });
};
