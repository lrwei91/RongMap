function sendError(res, error) {
  console.error('api v2 error:', error);
  const status = error.status || 500;
  const body = { error: status >= 500 ? '服务器暂时不可用' : error.message };
  if (status === 409 && error.latest) body.latest = error.latest;
  if (status === 409 && error.existing) body.existing = error.existing;
  return res.status(status).json(body);
}

function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return res.status(405).json({ error: '方法不允许' });
}

module.exports = { sendError, methodNotAllowed };
