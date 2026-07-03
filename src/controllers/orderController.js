'use strict';

const { supabase } = require('../config/database');
const { sendOrderConfirmationEmail, sendOrderStatusEmail } = require('../utils/mailer');

// Helper to generate unique order numbers
function generateOrderNumber() {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `CVT-${num}`;
}

// ── Customer Storefront Endpoints ────────────────────────────────────────────

// POST /api/orders
exports.createOrder = async (req, res) => {
  // Enforce customer auth
  if (!req.user || req.user.role !== 'customer') {
    return res.status(401).json({ success: false, message: 'Customer authentication required' });
  }

  const { tenantId, userId } = req.user;
  const { items, subtotal, discount = 0, total, couponCode, shippingAddress, paymentProvider } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ success: false, message: 'No items in order' });
  }

  try {
    // 1. Verify stock for each item & prepare items array
    const verifiedItems = [];
    for (const item of items) {
      const { data: product } = await supabase
        .from('products')
        .select('*')
        .eq('id', item.id || item.productId)
        .eq('tenant_id', tenantId)
        .single();

      if (!product) {
        return res.status(404).json({ success: false, message: `Product not found: ${item.name}` });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}`,
        });
      }

      verifiedItems.push({
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        quantity: item.quantity,
        image: product.images?.[0] || '',
      });
    }

    // 2. Decrement stock (Since there's no atomic decrement in REST easily without RPC, we just read and write back)
    for (const item of items) {
      const { data: p } = await supabase.from('products').select('stock').eq('id', item.id || item.productId).single();
      if (p) {
        await supabase.from('products').update({ stock: p.stock - item.quantity }).eq('id', item.id || item.productId);
      }
    }

    // 3. Generate unique order number
    let orderNumber = generateOrderNumber();
    let isUnique = false;
    while (!isUnique) {
      const { data: existing } = await supabase.from('orders').select('id').eq('order_number', orderNumber).single();
      if (!existing) isUnique = true;
      else orderNumber = generateOrderNumber();
    }

    // 4. Create Order
    const statusHistory = [{ status: 'pending', timestamp: new Date(), note: 'Order placed successfully' }];
    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        order_number: orderNumber,
        items: verifiedItems,
        subtotal,
        discount,
        total,
        coupon_code: couponCode,
        shipping_address: shippingAddress,
        payment_status: 'pending',
        payment_provider: paymentProvider,
        status: 'pending',
        status_history: statusHistory,
      })
      .select()
      .single();

    if (error) throw error;

    // Fire-and-forget confirmation email
    supabase.from('users').select('*').eq('id', userId).single().then(({ data: customer }) => {
      if (customer?.email) {
        sendOrderConfirmationEmail({ to: customer.email, name: customer.name, order })
          .catch((e) => console.error('[Mailer] order confirm email failed:', e.message));
      }
    }).catch(() => {});

    return res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('[Orders] createOrder error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/orders/:id
exports.getOrderById = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const { id } = req.params;

  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Customer can only view their own orders
    if (req.user.role === 'customer' && String(order.user_id) !== String(req.user.userId)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    // Admin can only view their own tenant's orders
    if (req.user.role === 'admin' && String(order.tenant_id) !== String(req.user.tenantId)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    return res.json(order);
  } catch (err) {
    console.error('[Orders] getOrderById error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/customers/me/orders
exports.getCustomerOrders = async (req, res) => {
  if (!req.user || req.user.role !== 'customer') {
    return res.status(401).json({ success: false, message: 'Customer authentication required' });
  }

  const { tenantId, userId } = req.user;

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(orders);
  } catch (err) {
    console.error('[Orders] getCustomerOrders error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin CMS Endpoints ──────────────────────────────────────────────────────

// GET /api/admin/orders
exports.adminGetOrders = async (req, res) => {
  const { tenantId } = req;

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*, user:users(name, email, phone)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Transform user object to match previous mongoose populate structure if needed
    const formatted = orders.map(o => ({
      ...o,
      userId: o.user
    }));

    return res.json(formatted);
  } catch (err) {
    console.error('[Orders] adminGetOrders error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// PUT /api/admin/orders/:id/status
exports.adminUpdateOrderStatus = async (req, res) => {
  const { tenantId } = req;
  const { id } = req.params;
  const { status, paymentStatus, note } = req.body;

  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const updates = {};
    if (status) {
      updates.status = status;
      const history = order.status_history || [];
      history.push({
        status,
        timestamp: new Date(),
        note: note || `Order status updated to ${status}`,
      });
      updates.status_history = history;
    }

    if (paymentStatus) {
      updates.payment_status = paymentStatus;
    }

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Fire-and-forget status update email
    if (status) {
      try {
        const { data: customer } = await supabase.from('users').select('*').eq('id', order.user_id).single();
        if (customer?.email) {
          sendOrderStatusEmail({
            to: customer.email,
            name: customer.name,
            order: updatedOrder,
            status,
          }).catch((e) => console.error('[Mailer] status email failed:', e.message));
        }
      } catch (_) { /* non-blocking */ }
    }

    return res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error('[Orders] adminUpdateOrderStatus error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};
