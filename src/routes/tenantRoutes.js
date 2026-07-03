'use strict';

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const {
  listTenants,
  createTenant,
  updateTenantStatus,
} = require('../controllers/tenantController');

// ── Admin Management Endpoints (Admin Only) ─────────────────────────────────
router.get('/superadmin/tenants', authenticate, roleGuard('admin'), listTenants);
router.post('/superadmin/tenants', authenticate, roleGuard('admin'), createTenant);
router.put('/superadmin/tenants/:id/status', authenticate, roleGuard('admin'), updateTenantStatus);

module.exports = router;
