'use strict';

const router = require('express').Router();
const { resolveTenantFromHeader, tenantScope } = require('../middleware/tenantScope');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const {
  getProducts,
  getFeaturedProducts,
  getProductBySlug,
  getBrandProducts,
  adminGetProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminImportProducts,
} = require('../controllers/productController');

// ── Public Storefront Endpoints ──────────────────────────────────────────────
router.get('/products', resolveTenantFromHeader, getProducts);
router.get('/products/featured', resolveTenantFromHeader, getFeaturedProducts);
router.get('/products/:slug', resolveTenantFromHeader, getProductBySlug);
router.get('/brands/:brand/products', resolveTenantFromHeader, getBrandProducts);

// ── Admin CMS Endpoints ──────────────────────────────────────────────────────
router.get('/admin/products', authenticate, roleGuard('admin'), tenantScope, adminGetProducts);
router.post('/admin/products', authenticate, roleGuard('admin'), tenantScope, adminCreateProduct);
router.put('/admin/products/:id', authenticate, roleGuard('admin'), tenantScope, adminUpdateProduct);
router.delete('/admin/products/:id', authenticate, roleGuard('admin'), tenantScope, adminDeleteProduct);
router.post('/admin/products/import', authenticate, roleGuard('admin'), tenantScope, adminImportProducts);

module.exports = router;
