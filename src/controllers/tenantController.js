'use strict';

const { supabase } = require('../config/database');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

// GET /api/superadmin/tenants
exports.listTenants = async (req, res) => {
  try {
    const { data: tenants, error } = await supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Enrich with additional metrics (e.g., admin email)
    const enriched = await Promise.all(
      tenants.map(async (t) => {
        const { data: admin } = await supabase
          .from('admins')
          .select('email')
          .eq('tenant_id', t.id)
          .eq('role', 'admin')
          .single();
          
        return {
          ...t,
          adminEmail: admin?.email || 'N/A',
        };
      })
    );

    return res.json(enriched);
  } catch (err) {
    console.error('[Tenant] listTenants error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error listing tenants' });
  }
};

// POST /api/superadmin/tenants
exports.createTenant = async (req, res) => {
  const { subdomain, businessName, email, password, name, plan } = req.body;

  if (!subdomain || !businessName || !email || !password || !name) {
    return res.status(400).json({
      success: false,
      message: 'All fields (subdomain, businessName, email, password, name) are required',
    });
  }

  try {
    // 1. Check if subdomain already exists
    const { data: existingTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('subdomain', subdomain.toLowerCase())
      .single();
      
    if (existingTenant) {
      return res.status(409).json({ success: false, message: 'Subdomain already exists' });
    }

    // 2. Check if admin email already exists globally in Admin collection
    const { data: existingAdmin } = await supabase
      .from('admins')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();
      
    if (existingAdmin) {
      return res.status(409).json({ success: false, message: 'Admin email already in use' });
    }

    // 3. Create Tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        subdomain: subdomain.toLowerCase(),
        business_name: businessName,
        email: email.toLowerCase(),
        plan: plan || 'trial',
        status: 'active',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        settings: {
          whatsappNumber: '918850852021',
          whatsappTemplates: {
            orderConfirmation: 'Dear {{name}}, your order {{orderNumber}} for {{total}} has been confirmed!',
            statusUpdate: 'Dear {{name}}, your order {{orderNumber}} is now {{status}}.',
            enquiryReply: 'Hello, thank you for enquiring about {{productName}}. How can we assist you?',
            cartAbandonment: 'Hi {{name}}, we noticed you left some luxury timepieces in your cart. Check out now!',
          },
          theme: {
            primaryColor: '#C9A84C',
          },
          seo: {
            title: `${businessName} | Chrono Craft Reseller`,
            description: `Premium luxury watch reseller store powered by Chrono Craft.`,
          }
        }
      })
      .select()
      .single();

    if (tenantError) throw tenantError;

    // 4. Create Tenant Admin account
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .insert({
        tenant_id: tenant.id,
        name,
        email: email.toLowerCase(),
        password_hash: passwordHash,
        role: 'admin'
      })
      .select()
      .single();

    if (adminError) throw adminError;

    return res.status(201).json({
      success: true,
      tenant,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (err) {
    console.error('[Tenant] createTenant error:', err.message);
    return res.status(500).json({ success: false, message: err.message || 'Server error creating tenant' });
  }
};

// PUT /api/superadmin/tenants/:id/status
exports.updateTenantStatus = async (req, res) => {
  const { id } = req.params;
  const { status, plan } = req.body;

  try {
    const updates = {};
    if (status) updates.status = status;
    if (plan) updates.plan = plan;

    const { data: tenant, error } = await supabase
      .from('tenants')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ success: false, message: 'Tenant not found' });
      }
      throw error;
    }

    return res.json({ success: true, tenant });
  } catch (err) {
    console.error('[Tenant] updateTenantStatus error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error updating tenant status' });
  }
};
