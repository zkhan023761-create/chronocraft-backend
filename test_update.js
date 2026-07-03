'use strict';
require('dotenv').config();
const { supabase } = require('./src/config/database');

async function run() {
  console.log('Fetching all tenants...');
  const { data: tenants, error } = await supabase.from('tenants').select('*');
  if (error) {
    console.error('Error fetching tenants:', error);
  } else {
    console.log('Tenants in DB:', tenants);
  }
}

run();
