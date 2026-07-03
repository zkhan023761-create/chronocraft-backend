'use strict';

const { verifyToken } = require('../utils/jwt');

/**
 * Authenticate middleware — verifies Bearer JWT and attaches decoded payload to req.user
 */
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyToken(token, 'access');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * Optional authenticate — attaches user if token present, doesn't block if absent
 */
const optionalAuthenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(authHeader.split(' ')[1], 'access');
    } catch {
      // invalid token — treat as unauthenticated
    }
  }
  next();
};

module.exports = { authenticate, optionalAuthenticate };
