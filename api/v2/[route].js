const handlers = {
  bootstrap: require('../../lib/api-v2/bootstrap'),
  bulk: require('../../lib/api-v2/bulk'),
  'import-commit': require('../../lib/api-v2/import-commit'),
  'import-preview': require('../../lib/api-v2/import-preview'),
  locations: require('../../lib/api-v2/locations'),
  members: require('../../lib/api-v2/members'),
  'public-share': require('../../lib/api-v2/public-share'),
  'share-links': require('../../lib/api-v2/share-links'),
  tags: require('../../lib/api-v2/tags'),
  trash: require('../../lib/api-v2/trash')
};

module.exports = async function handler(req, res) {
  const route = String(req.query?.route || '');
  const routeHandler = handlers[route];
  if (!routeHandler) return res.status(404).json({ error: '接口不存在' });
  return routeHandler(req, res);
};

module.exports.handlers = handlers;
