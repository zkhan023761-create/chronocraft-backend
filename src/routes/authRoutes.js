'use strict';

const router = require('express').Router();
const { body } = require('express-validator');
const {
  customerRegister,
  customerLogin,
  adminLogin,
  refreshToken,
  logout,
  forgotPassword,
  verifyOtp,
  resetPassword,
  getCustomerProfile,
  updateCustomerProfile,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// ── Validation rules ──────────────────────────────────────────────────────────

const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

const loginValidation = [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/customer/register', registerValidation, customerRegister);
router.post('/customer/login', loginValidation, customerLogin);
router.post('/admin/login', loginValidation, adminLogin);
router.post('/refresh', refreshToken);
router.post('/logout', logout);

// Password reset via OTP
router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);

// Customer Profile
router.get('/customer/profile', authenticate, getCustomerProfile);
router.put('/customer/profile', authenticate, updateCustomerProfile);

module.exports = router;
