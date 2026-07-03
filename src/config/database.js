'use strict';

const { createClient } = require('@supabase/supabase-js');

// Initialize the Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('[DB] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const connectDB = async () => {
  try {
    // There is no persistent connection needed to establish for Supabase REST clients,
    // but we can make a simple query to verify it works.
    const { error } = await supabase.from('tenants').select('id').limit(1);
    if (error) throw error;
    console.log(`[DB] Supabase connected successfully.`);
  } catch (err) {
    console.error(`[DB] Failed to connect to Supabase: ${err.message}`);
    process.exit(1);
  }
};

module.exports = { connectDB, supabase };
