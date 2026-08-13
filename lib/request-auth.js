const crypto = require('crypto');

function verifyBearerSecret(req, secret) {
  const authHeader = String(req.headers?.authorization || '');
  if (!secret || !authHeader.startsWith('Bearer ')) return false;
  const token = Buffer.from(authHeader.slice(7));
  const expected = Buffer.from(secret);
  return token.length === expected.length && crypto.timingSafeEqual(token, expected);
}

module.exports = { verifyBearerSecret };
