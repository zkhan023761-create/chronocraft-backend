'use strict';

const router = require('express').Router();
const { tenantScope, resolveTenantFromHeader } = require('../middleware/tenantScope');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const {
  getSummary,
  getSalesChart,
  getUsersList,
  getWhatsAppLogs,
  logWhatsAppEnquiry,
} = require('../controllers/analyticsController');

// ── Public Storefront Endpoints ──────────────────────────────────────────────
router.post('/whatsapp/enquiry', resolveTenantFromHeader, logWhatsAppEnquiry);

// ── Admin CMS Endpoints ──────────────────────────────────────────────────────
router.get('/admin/analytics/summary', authenticate, roleGuard('admin'), tenantScope, getSummary);
router.get('/admin/analytics/sales', authenticate, roleGuard('admin'), tenantScope, getSalesChart);
router.get('/admin/users', authenticate, roleGuard('admin'), tenantScope, getUsersList);
router.get('/admin/whatsapp/logs', authenticate, roleGuard('admin'), tenantScope, getWhatsAppLogs);

module.exports = router;
