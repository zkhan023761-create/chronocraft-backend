'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const { generalLimiter, authLimiter, adminLimiter, orderLimiter } = require('./middleware/rateLimiter');
const { forgotPassword } = require('./controllers/authController');
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const orderRoutes = require('./routes/orderRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const tenantRoutes = require('./routes/tenantRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const { startOrderScheduler } = require('./utils/orderScheduler');
const { connectDB } = require('./config/database');
const { resolveTenantFromHeader } = require('./middleware/tenantScope');

const app = express();

// ── Compatibility layer: Map id to _id and snake_case to camelCase in all JSON responses for Client ──
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    const snakeToCamel = (str) => {
      return str.replace(/_([a-z])/g, (m, letter) => letter.toUpperCase());
    };

    const addCompatibilityKeys = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (obj instanceof Date || obj instanceof RegExp || Buffer.isBuffer(obj)) {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(addCompatibilityKeys);
      }
      
      const newObj = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          const val = addCompatibilityKeys(obj[key]);
          newObj[key] = val;
          
          // Map snake_case keys to camelCase next to original keys
          if (key.includes('_')) {
            const camelKey = snakeToCamel(key);
            if (newObj[camelKey] === undefined) {
              newObj[camelKey] = val;
            }
          }
        }
      }
      
      // Map id to _id
      if (newObj.id !== undefined && newObj._id === undefined) {
        newObj._id = newObj.id;
      }

      // Map reviews 'comment' to 'quote' and 'user.name' to 'reviewerName'
      if (newObj.comment !== undefined && newObj.quote === undefined) {
        newObj.quote = newObj.comment;
      }
      if (newObj.user && newObj.user.name && newObj.reviewerName === undefined) {
        newObj.reviewerName = newObj.user.name;
      }
      if (newObj.comment !== undefined && newObj.reviewerName === undefined) {
        newObj.reviewerName = 'Anonymous Customer';
      }
      if (newObj.comment !== undefined && newObj.reviewerLocation === undefined) {
        newObj.reviewerLocation = 'Verified Buyer';
      }
      return newObj;
    };

    const modifiedBody = addCompatibilityKeys(body);
    return originalJson.call(this, modifiedBody);
  };
  next();
});

// ── Security & request middleware ────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'https://chronocraft-client.vercel.app',
      process.env.CORS_ORIGIN
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());



// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api', generalLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
// Forgot-password is exempt from rate limiting
app.post('/api/auth/forgot-password', resolveTenantFromHeader, forgotPassword);
app.use('/api/auth', authLimiter, resolveTenantFromHeader, authRoutes);
app.use('/api', productRoutes);
app.use('/api/orders', orderLimiter);
app.use('/api', orderRoutes);
app.use('/api/admin', adminLimiter);
app.use('/api', analyticsRoutes);
app.use('/api', tenantRoutes);
app.use('/api', uploadRoutes);
app.use('/api', reviewRoutes);

// ── 404 fallback ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
});

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function start() {
  // Connect to database
  await connectDB();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[Server] Chrono Craft API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`
    );
  });

  // ── Start background order auto-progression scheduler ──────────────────
  startOrderScheduler();
}

start();

module.exports = app; // exported for testing
// server restart trigger
