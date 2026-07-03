'use strict';

const { supabase } = require('../config/database');

// GET /api/admin/analytics/summary
exports.getSummary = async (req, res) => {
  const { tenantId } = req;

  try {
    // 1. Total Registered Users
    const { count: totalUsers, error: usersErr } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    if (usersErr) throw usersErr;

    // 2. Total Sales Revenue
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('total, items')
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid')
      .neq('status', 'cancelled');

    if (ordersErr) throw ordersErr;

    const totalRevenue = orders.reduce((sum, order) => sum + Number(order.total), 0);

    // 3. Active Orders count
    const { count: activeOrders, error: activeErr } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'confirmed', 'processing', 'shipped']);

    if (activeErr) throw activeErr;

    // 4. Low stock products (stock <= 3)
    const { data: lowStockAlerts, error: stockErr } = await supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .lte('stock', 3)
      .neq('is_archived', true);

    if (stockErr) throw stockErr;

    // 5. WhatsApp enquiries - We don't have WhatsAppLogs table in schema, using a fallback or empty
    const totalEnquiries = 0;
    const whatsappConversionRate = 0;

    // 6. Top 5 sold products
    // Aggregate from orders data in memory
    const productStats = {};
    for (const order of orders) {
      const items = order.items || [];
      for (const item of items) {
        if (!productStats[item.productId]) {
          productStats[item.productId] = {
            id: item.productId,
            name: item.name,
            sku: item.sku,
            sales: 0,
            revenue: 0
          };
        }
        productStats[item.productId].sales += item.quantity;
        productStats[item.productId].revenue += (item.price * item.quantity);
      }
    }

    const topProducts = Object.values(productStats)
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 5);

    return res.json({
      success: true,
      summary: {
        totalUsers: totalUsers || 0,
        totalRevenue,
        activeOrders: activeOrders || 0,
        lowStockCount: lowStockAlerts?.length || 0,
        whatsappEnquiries: totalEnquiries,
        whatsappConversionRate,
      },
      lowStockAlerts: lowStockAlerts || [],
      topProducts,
    });
  } catch (err) {
    console.error('[Analytics] getSummary error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/admin/analytics/sales
exports.getSalesChart = async (req, res) => {
  const { tenantId } = req;

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: orders, error } = await supabase
      .from('orders')
      .select('created_at, total')
      .eq('tenant_id', tenantId)
      .eq('payment_status', 'paid')
      .neq('status', 'cancelled')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (error) throw error;

    // Aggregate in memory
    const salesMap = {};
    for (const order of orders) {
      const date = order.created_at.split('T')[0];
      if (!salesMap[date]) {
        salesMap[date] = { _id: date, revenue: 0, orders: 0 };
      }
      salesMap[date].revenue += Number(order.total);
      salesMap[date].orders += 1;
    }

    const sales = Object.values(salesMap).sort((a, b) => a._id.localeCompare(b._id));

    return res.json(sales);
  } catch (err) {
    console.error('[Analytics] getSalesChart error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/admin/users
exports.getUsersList = async (req, res) => {
  const { tenantId } = req;

  try {
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('*')
      .eq('tenant_id', tenantId);

    if (usersErr) throw usersErr;

    // Remove password hash from response
    const sanitizedUsers = users.map(u => {
      const { password_hash, ...rest } = u;
      return rest;
    });

    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('user_id, payment_status, status, total')
      .eq('tenant_id', tenantId);

    if (ordersErr) throw ordersErr;

    // Attach order history stats
    const usersWithStats = sanitizedUsers.map((user) => {
      const userOrders = orders.filter(o => o.user_id === user.id);
      const totalSpent = userOrders
        .filter((o) => o.payment_status === 'paid' && o.status !== 'cancelled')
        .reduce((sum, o) => sum + Number(o.total), 0);

      return {
        ...user,
        orderCount: userOrders.length,
        totalSpent,
      };
    });

    return res.json(usersWithStats);
  } catch (err) {
    console.error('[Analytics] getUsersList error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// GET /api/admin/whatsapp/logs
exports.getWhatsAppLogs = async (req, res) => {
  return res.json([]);
};

// POST /api/whatsapp/enquiry
exports.logWhatsAppEnquiry = async (req, res) => {
  return res.status(201).json({ success: true, message: 'Not implemented' });
};
