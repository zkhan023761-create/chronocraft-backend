'use strict';

/**
 * roleGuard — factory middleware that restricts access to specified roles
 * Usage: router.get('/admin-only', authenticate, roleGuard('admin', 'superadmin'), handler)
 * @param {...string} allowedRoles
 */
const roleGuard = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: requires role ${allowedRoles.join(' or ')}`,
      });
    }
    next();
  };
};

module.exports = { roleGuard };
