// src/contactsDb.js - CRUD de contactos en Supabase
const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (!url || !key) throw new Error('Faltan SUPABASE_URL y SUPABASE_KEY en .env');
    supabase = createClient(url, key);
  }
  return supabase;
}

/**
 * Obtiene un contacto por JID.
 * Retorna null si no existe.
 */
async function getContact(jid) {
  try {
    const { data, error } = await getSupabase()
      .from('contacts')
      .select('*')
      .eq('jid', jid)
      .single();
    if (error && error.code === 'PGRST116') return null; // no rows
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[ContactsDB] getContact error:', err.message);
    return null;
  }
}

/**
 * Crea o actualiza un contacto.
 */
async function upsertContact(jid, fields = {}) {
  try {
    const { error } = await getSupabase()
      .from('contacts')
      .upsert({ jid, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'jid' });
    if (error) throw error;
  } catch (err) {
    console.error('[ContactsDB] upsertContact error:', err.message);
  }
}

/**
 * Guarda la personalidad y marca el onboarding como completo.
 */
async function setPersonality(jid, personality, name = null) {
  const fields = { personality, onboarding_done: true };
  if (name) fields.name = name;
  await upsertContact(jid, fields);
}

/**
 * Marca el onboarding como iniciado (contacto creado por primera vez).
 */
async function createContactIfNew(jid, name = null) {
  const existing = await getContact(jid);
  if (!existing) {
    await upsertContact(jid, { name, onboarding_done: false });
  }
  return existing;
}

module.exports = { getContact, upsertContact, setPersonality, createContactIfNew };
