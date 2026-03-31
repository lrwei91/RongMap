import https from 'https';

const AMAP_CONFIG = {
  webServiceKey: '8df650b9d87529c0d756660265fa82a2'
};

export default function handler(req, res) {
  if (req.method === 'POST') {
    const { keywords, city } = req.body;

    if (!keywords) {
      return res.status(400).json({ error: '搜索关键词不能为空' });
    }

    const url = `https://restapi.amap.com/v3/place/text?key=${AMAP_CONFIG.webServiceKey}&keywords=${encodeURIComponent(keywords)}&city=${city || '0591'}&output=json`;

    https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          res.status(200).json(result);
        } catch (err) {
          res.status(500).json({ error: '解析搜索响应失败' });
        }
      });
    }).on('error', (err) => {
      res.status(500).json({ error: '搜索请求失败：' + err.message });
    });
    return;
  }

  return res.status(405).json({ error: '方法不允许' });
}
