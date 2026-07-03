'use strict';

const router = require('express').Router();
const { tenantScope } = require('../middleware/tenantScope');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const {
  createOrder,
  getOrderById,
  getCustomerOrders,
  adminGetOrders,
  adminUpdateOrderStatus,
} = require('../controllers/orderController');

// ── Customer Storefront Endpoints ────────────────────────────────────────────
router.post('/orders', authenticate, createOrder);
router.get('/orders/:id', authenticate, getOrderById);
router.get('/customers/me/orders', authenticate, getCustomerOrders);

// ── Admin CMS Endpoints ──────────────────────────────────────────────────────
router.get('/admin/orders', authenticate, roleGuard('admin'), tenantScope, adminGetOrders);
router.put('/admin/orders/:id/status', authenticate, roleGuard('admin'), tenantScope, adminUpdateOrderStatus);

module.exports = router;
