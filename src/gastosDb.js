// src/gastosDb.js - CRUD de datos del bot de Finanzas por usuario en Supabase
// SQL requerido en Supabase:
//   ALTER TABLE contacts ADD COLUMN IF NOT EXISTS gastos_data JSONB DEFAULT '{}';

const { getContact, upsertContact } = require('./contactsDb');

const DEFAULT_GASTOS_DATA = {
  sheet_id: null,
  sheet_url: null,
  // null | 'goals' | 'income' | 'payday' | 'accounts' | 'crypto' | 'savings_goal' | 'confirm' | 'complete'
  onboarding_step: null,
  onboarding_data: {},
  config: {
    goals: [],
    salary: null,
    salary_frequency: 'monthly',
    payday: [],
    savings_goal: null,
    accounts: [],
    crypto: [],
    fx_holdings: [],
  },
};

async function getGastosData(jid) {
  try {
    const contact = await getContact(jid);
    const stored = contact?.gastos_data || {};
    return {
      ...DEFAULT_GASTOS_DATA,
      ...stored,
      config: { ...DEFAULT_GASTOS_DATA.config, ...(stored.config || {}) },
    };
  } catch (err) {
    console.error('[GastosDB] getGastosData error:', err.message);
    return { ...DEFAULT_GASTOS_DATA };
  }
}

async function setGastosData(jid, updates) {
  const current = await getGastosData(jid);
  const merged = { ...current, ...updates };
  await upsertContact(jid, { gastos_data: merged });
  return merged;
}

async function updateGastosConfig(jid, configUpdates) {
  const current = await getGastosData(jid);
  const merged = {
    ...current,
    config: { ...current.config, ...configUpdates },
  };
  await upsertContact(jid, { gastos_data: merged });
  return merged;
}

/**
 * Retorna todos los contactos con gastos activos (para el salary scheduler).
 */
async function getAllGastosUsers() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('jid, name, gastos_data')
      .not('gastos_data->sheet_id', 'is', null);
    if (error) throw error;
    return (data || []).filter(c => c.gastos_data?.onboarding_step === 'complete');
  } catch (err) {
    console.error('[GastosDB] getAllGastosUsers error:', err.message);
    return [];
  }
}

/**
 * Resetea los datos de gastos de TODOS los contactos.
 * Equivalente al SQL: UPDATE contacts SET gastos_data = '{}';
 */
async function resetAllGastosData() {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  try {
    const { error } = await supabase
      .from('contacts')
      .update({ gastos_data: {} })
      .neq('jid', ''); // aplica a todos los registros
    if (error) throw error;
    console.log('[GastosDB] Todos los datos de gastos reseteados.');
    return true;
  } catch (err) {
    console.error('[GastosDB] resetAllGastosData error:', err.message);
    return false;
  }
}

/**
 * Resetea los datos de gastos de un usuario específico.
 */
async function resetGastosData(jid) {
  await upsertContact(jid, { gastos_data: {} });
}

module.exports = { getGastosData, setGastosData, updateGastosConfig, getAllGastosUsers, resetAllGastosData, resetGastosData, DEFAULT_GASTOS_DATA };
