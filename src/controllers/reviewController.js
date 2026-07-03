'use strict';

const { supabase } = require('../config/database');

// ── Public ────────────────────────────────────────────────────────────────────

// GET /api/reviews  — storefront (published only)
exports.getPublicReviews = async (req, res) => {
  const { tenantId } = req;
  try {
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('*, user:users(name)')
      .eq('tenant_id', tenantId)
      .eq('is_approved', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, reviews });
  } catch (err) {
    console.error('[Reviews] getPublicReviews error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/reviews — post storefront review (auto-approves for demo convenience)
exports.createPublicReview = async (req, res) => {
  const { tenantId } = req;
  const { rating, comment, productId } = req.body;

  if (!rating || !comment) {
    return res.status(400).json({ success: false, message: 'Rating and comment are required' });
  }

  try {
    let userId = null;
    
    // Check auth Bearer token
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      try {
        const token = req.headers.authorization.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch (err) {
        // Ignored
      }
    }

    // Fallback to first user in tenant if not authenticated (foreign key NOT NULL constraint)
    if (!userId) {
      const { data: tenantUsers } = await supabase
        .from('users')
        .select('id')
        .eq('tenant_id', tenantId)
        .limit(1);
      if (tenantUsers && tenantUsers.length > 0) {
        userId = tenantUsers[0].id;
      } else {
        return res.status(400).json({ success: false, message: 'No customer user found to associate the review with.' });
      }
    }

    const { data: review, error } = await supabase
      .from('reviews')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        product_id: productId || null,
        rating: Number(rating),
        comment: comment,
        is_approved: true,
      })
      .select('*, user:users(name)')
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, review });
  } catch (err) {
    console.error('[Reviews] createPublicReview error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error posting review' });
  }
};

// ── Admin ─────────────────────────────────────────────────────────────────────

// GET /api/admin/reviews
exports.adminGetReviews = async (req, res) => {
  const { tenantId } = req;
  try {
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('*, user:users(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ success: true, reviews });
  } catch (err) {
    console.error('[Reviews] adminGetReviews error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// POST /api/admin/reviews
exports.adminCreateReview = async (req, res) => {
  const { tenantId } = req;
  const { reviewerName, reviewerLocation, rating, quote, productId, isPublished, displayOrder } = req.body;

  if (!reviewerName || !rating || !quote) {
    return res.status(400).json({ success: false, message: 'reviewerName, rating and quote are required' });
  }

  try {
    const { data: review, error } = await supabase
      .from('reviews')
      .insert({
        tenant_id: tenantId,
        // We map these to comment/rating/etc since our schema doesn't match perfectly
        // We will just store what we have that matches
        rating: Number(rating),
        comment: quote,
        product_id: productId || null,
        is_approved: isPublished !== undefined ? Boolean(isPublished) : true,
      })
      .select()
      .single();

    if (error) throw error;
    return res.status(201).json({ success: true, review });
  } catch (err) {
    console.error('[Reviews] adminCreateReview error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// PUT /api/admin/reviews/:id
exports.adminUpdateReview = async (req, res) => {
  const { tenantId } = req;
  const { id } = req.params;
  const { rating, quote, productId, isPublished } = req.body;

  try {
    const updates = {};
    if (rating !== undefined) updates.rating = Number(rating);
    if (quote !== undefined) updates.comment = quote;
    if (productId !== undefined) updates.product_id = productId || null;
    if (isPublished !== undefined) updates.is_approved = Boolean(isPublished);

    const { data: review, error } = await supabase
      .from('reviews')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ success: false, message: 'Review not found' });
      throw error;
    }
    return res.json({ success: true, review });
  } catch (err) {
    console.error('[Reviews] adminUpdateReview error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// DELETE /api/admin/reviews/:id
exports.adminDeleteReview = async (req, res) => {
  const { tenantId } = req;
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return res.json({ success: true, message: 'Review deleted' });
  } catch (err) {
    console.error('[Reviews] adminDeleteReview error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
