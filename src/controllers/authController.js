'use strict';

const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { supabase } = require('../config/database');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt');
const { sendOtpEmail } = require('../utils/mailer');

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLockedOut(account) {
  return account.lock_until && new Date(account.lock_until).getTime() > Date.now();
}

function lockoutMinutesRemaining(account) {
  return Math.ceil((new Date(account.lock_until).getTime() - Date.now()) / 60000);
}

async function handleFailedLogin(table, account) {
  const newAttempts = (account.login_attempts || 0) + 1;
  const updates = { login_attempts: newAttempts };
  
  if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
    updates.lock_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
  }
  
  await supabase.from(table).update(updates).eq('id', account.id);
}

async function handleSuccessfulLogin(table, account) {
  await supabase.from(table).update({
    login_attempts: 0,
    lock_until: null
  }).eq('id', account.id);
}

async function issueTokens(payload, table, account, res) {
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Store hashed refresh token for rotation verification
  const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
  
  await supabase.from(table).update({ refresh_token_hash: refreshTokenHash }).eq('id', account.id);

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);
  return accessToken;
}

// ── Customer Register ─────────────────────────────────────────────────────────

exports.customerRegister = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { name, email, password, phone } = req.body;
  const tenantId = req.tenantId || req.headers['x-tenant-id'];

  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'Tenant context missing' });
  }

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        tenant_id: tenantId,
        name,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        phone,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '' },
    });
  } catch (err) {
    console.error('[Auth] customerRegister error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Customer Login ────────────────────────────────────────────────────────────

exports.customerLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;
  const tenantId = req.tenantId || req.headers['x-tenant-id'];

  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'Tenant context missing' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('email', email.toLowerCase())
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[Auth] Database error in customerLogin:', error.message || error);
      return res.status(500).json({ success: false, message: 'Database connection error' });
    }

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, message: 'Account has been blocked' });
    }

    if (isLockedOut(user)) {
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${lockoutMinutesRemaining(user)} minute(s)`,
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      await handleFailedLogin('users', user);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await handleSuccessfulLogin('users', user);

    const payload = { userId: user.id, tenantId: user.tenant_id, role: 'customer', email: user.email };
    const accessToken = await issueTokens(payload, 'users', user, res);

    return res.json({
      success: true,
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '', role: 'customer' },
    });
  } catch (err) {
    console.error('[Auth] customerLogin error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin Login ───────────────────────────────────────────────────────────────

exports.adminLogin = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const { data: admin, error } = await supabase
      .from('admins')
      .select('*')
      .eq('email', normalizedEmail)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[Auth] Database error in adminLogin:', error.message || error);
      return res.status(500).json({ success: false, message: 'Database connection error' });
    }

    // Check if active (we didn't put isActive in schema, defaulting to true or checking role)
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (isLockedOut(admin)) {
      return res.status(429).json({
        success: false,
        message: `Too many failed attempts. Try again in ${lockoutMinutesRemaining(admin)} minute(s)`,
      });
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      await handleFailedLogin('admins', admin);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await handleSuccessfulLogin('admins', admin);

    const payload = { adminId: admin.id, tenantId: admin.tenant_id, role: 'admin', email: admin.email };
    const accessToken = await issueTokens(payload, 'admins', admin, res);

    return res.json({
      success: true,
      accessToken,
      user: { id: admin.id, name: admin.name, email: admin.email, role: 'admin', tenantId: admin.tenant_id },
    });
  } catch (err) {
    console.error('[Auth] adminLogin error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Refresh Token ─────────────────────────────────────────────────────────────

exports.refreshToken = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) {
    return res.status(401).json({ success: false, message: 'No refresh token' });
  }

  try {
    const decoded = verifyToken(token, 'refresh');

    let account;
    let table;
    if (decoded.userId) {
      table = 'users';
      const { data } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
      account = data;
    } else if (decoded.adminId) {
      table = 'admins';
      const { data } = await supabase.from('admins').select('*').eq('id', decoded.adminId).single();
      account = data;
    }

    if (!account || !account.refresh_token_hash) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token' });
    }

    const isValid = await bcrypt.compare(token, account.refresh_token_hash);
    if (!isValid) {
      await supabase.from(table).update({ refresh_token_hash: null }).eq('id', account.id);
      return res.status(401).json({ success: false, message: 'Refresh token reuse detected' });
    }

    const payload = decoded.userId
      ? { userId: decoded.userId, tenantId: decoded.tenantId, role: decoded.role, email: decoded.email }
      : { adminId: decoded.adminId, tenantId: decoded.tenantId, role: decoded.role, email: decoded.email };

    const newAccessToken = await issueTokens(payload, table, account, res);

    return res.json({ success: true, accessToken: newAccessToken });
  } catch (err) {
    res.clearCookie('refreshToken');
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
  }
};

// ── Logout ────────────────────────────────────────────────────────────────────

exports.logout = async (req, res) => {
  const token = req.cookies.refreshToken;

  if (token) {
    try {
      const decoded = verifyToken(token, 'refresh');
      if (decoded.userId) {
        await supabase.from('users').update({ refresh_token_hash: null }).eq('id', decoded.userId);
      } else if (decoded.adminId) {
        await supabase.from('admins').update({ refresh_token_hash: null }).eq('id', decoded.adminId);
      }
    } catch {
      // Token invalid — still clear cookie
    }
  }

  res.clearCookie('refreshToken');
  return res.json({ success: true, message: 'Logged out successfully' });
};

// ── Forgot Password — send OTP ─────────────────────────────────────────────────

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  const tenantId = req.tenantId || req.headers['x-tenant-id'];

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    let query = supabase.from('users').select('*').eq('email', email.toLowerCase().trim());
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data: user } = await query.single();

    if (!user) {
      return res.json({ success: true, message: 'If that email exists, an OTP has been sent.' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await bcrypt.hash(otp, 10);

    await supabase.from('users').update({
      reset_otp: otpHash,
      reset_otp_expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      reset_otp_attempts: 0
    }).eq('id', user.id);

    await sendOtpEmail({ to: user.email, name: user.name, otp });

    return res.json({ success: true, message: 'If that email exists, an OTP has been sent.' });
  } catch (err) {
    console.error('[Auth] forgotPassword error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Verify OTP ────────────────────────────────────────────────────────────────

exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  const tenantId = req.tenantId || req.headers['x-tenant-id'];

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required' });
  }

  try {
    let query = supabase.from('users').select('*').eq('email', email.toLowerCase().trim());
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data: user } = await query.single();

    if (!user || !user.reset_otp || !user.reset_otp_expiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    if (new Date(user.reset_otp_expiry).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if ((user.reset_otp_attempts || 0) >= 5) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Please request a new OTP.' });
    }

    const isValid = await bcrypt.compare(otp, user.reset_otp);
    if (!isValid) {
      await supabase.from('users').update({ reset_otp_attempts: (user.reset_otp_attempts || 0) + 1 }).eq('id', user.id);
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    await supabase.from('users').update({
      reset_otp_attempts: 0,
      reset_otp_expiry: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }).eq('id', user.id);

    return res.json({ success: true, message: 'OTP verified. You may now reset your password.' });
  } catch (err) {
    console.error('[Auth] verifyOtp error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Reset Password ────────────────────────────────────────────────────────────

exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;
  const tenantId = req.tenantId || req.headers['x-tenant-id'];

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email, OTP and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }

  try {
    let query = supabase.from('users').select('*').eq('email', email.toLowerCase().trim());
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data: user } = await query.single();

    if (!user || !user.reset_otp || !user.reset_otp_expiry) {
      return res.status(400).json({ success: false, message: 'Invalid or expired session. Please start over.' });
    }

    if (new Date(user.reset_otp_expiry).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Session expired. Please request a new OTP.' });
    }

    const isValid = await bcrypt.compare(otp, user.reset_otp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid session. Please start over.' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await supabase.from('users').update({
      password_hash: passwordHash,
      reset_otp: null,
      reset_otp_expiry: null,
      reset_otp_attempts: 0,
      login_attempts: 0,
      lock_until: null
    }).eq('id', user.id);

    return res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error('[Auth] resetPassword error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Customer Profile ─────────────────────────────────────────────────────────

exports.getCustomerProfile = async (req, res) => {
  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.userId).single();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
      }
    });
  } catch (err) {
    console.error('[Auth] getCustomerProfile error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateCustomerProfile = async (req, res) => {
  const { name, email, phone, currentPassword, newPassword } = req.body;
  try {
    const { data: user } = await supabase.from('users').select('*').eq('id', req.user.userId).single();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const updates = {};

    if (email && email.toLowerCase() !== user.email.toLowerCase()) {
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('tenant_id', user.tenant_id)
        .eq('email', email.toLowerCase())
        .single();
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email address is already in use' });
      }
      updates.email = email.toLowerCase().trim();
    }

    if (name) updates.name = name.trim();
    if (phone !== undefined) updates.phone = phone.trim();

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required to change password' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'New password must be at least 8 characters' });
      }
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isPasswordValid) {
        return res.status(400).json({ success: false, message: 'Invalid current password' });
      }
      updates.password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone || '',
      }
    });
  } catch (err) {
    console.error('[Auth] updateCustomerProfile error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
