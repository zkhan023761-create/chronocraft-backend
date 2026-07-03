'use strict';

const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { roleGuard } = require('../middleware/roleGuard');
const { uploadToCloudinary } = require('../utils/cloudinary');

// Store file in memory (we stream directly to Cloudinary)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'), false);
    }
    cb(null, true);
  },
});

// POST /api/upload/image  — admin only
router.post(
  '/upload/image',
  authenticate,
  roleGuard('admin'),
  upload.single('image'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    try {
      const { url, publicId } = await uploadToCloudinary(req.file.buffer, {
        folder: 'chrono-craft/products',
      });
      return res.json({ success: true, url, publicId });
    } catch (err) {
      console.error('[Upload] Cloudinary error:', err.message);
      return res.status(500).json({ success: false, message: 'Image upload failed' });
    }
  }
);

module.exports = router;
