'use strict';

const jwt = require('jsonwebtoken');

/**
 * Sign a short-lived access token (15 min)
 * @param {object} payload - { userId|adminId, tenantId, role, email }
 */
const signAccessToken = (payload) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
};

/**
 * Sign a long-lived refresh token (7 days)
 */
const signRefreshToken = (payload) => {
  if (!process.env.JWT_REFRESH_SECRET) throw new Error('JWT_REFRESH_SECRET is not set');
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
};

/**
 * Verify a token — throws if invalid or expired
 * @param {string} token
 * @param {'access'|'refresh'} type
 */
const verifyToken = (token, type = 'access') => {
  const secret =
    type === 'refresh' ? process.env.JWT_REFRESH_SECRET : process.env.JWT_SECRET;
  if (!secret) throw new Error(`Secret for token type "${type}" is not set`);
  return jwt.verify(token, secret);
};

module.exports = { signAccessToken, signRefreshToken, verifyToken };
