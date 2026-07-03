'use strict';

const router = require('express').Router();
const { resolveTenantFromHeader, tenantScope } = require('../middleware/tenantScope');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const {
  getPublicReviews,
  createPublicReview,
  adminGetReviews,
  adminCreateReview,
  adminUpdateReview,
  adminDeleteReview,
} = require('../controllers/reviewController');

// ── Public storefront ────────────────────────────────────────────────────────
router.get('/reviews', resolveTenantFromHeader, getPublicReviews);
router.post('/reviews', resolveTenantFromHeader, createPublicReview);

// ── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin/reviews',      authenticate, roleGuard('admin'), tenantScope, adminGetReviews);
router.post('/admin/reviews',     authenticate, roleGuard('admin'), tenantScope, adminCreateReview);
router.put('/admin/reviews/:id',  authenticate, roleGuard('admin'), tenantScope, adminUpdateReview);
router.delete('/admin/reviews/:id', authenticate, roleGuard('admin'), tenantScope, adminDeleteReview);

module.exports = router;
