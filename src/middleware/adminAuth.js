// Protects admin endpoints: no token -> 401, wrong token -> 403.
const crypto = require('crypto');
const config = require('../config');
const { apiError } = require('./errors');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = function adminAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return apiError(res, 401, '401', 'Admin token required (Authorization: Bearer <token>).');
  if (!config.adminToken || !safeEqual(token, config.adminToken)) {
    return apiError(res, 403, '403', 'This token is not allowed to manage tickets.');
  }
  next();
};
