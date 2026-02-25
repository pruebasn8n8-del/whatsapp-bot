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

/**
 * Persiste el paso y datos del onboarding en Supabase.
 * Permite sobrevivir reinicios del servidor.
 */
async function saveOnboardingSession(jid, step, data) {
  await upsertContact(jid, { onboarding_step: step, onboarding_data: data });
}

/**
 * Lee el paso del onboarding desde Supabase.
 * Retorna { step, data } o null si no hay sesión activa.
 */
async function getOnboardingSessionFromDB(jid) {
  const contact = await getContact(jid);
  if (!contact || !contact.onboarding_step) return null;
  return { step: contact.onboarding_step, data: contact.onboarding_data || {} };
}

/**
 * Limpia el paso del onboarding al completarlo.
 */
async function clearOnboardingSession(jid) {
  await upsertContact(jid, { onboarding_step: null, onboarding_data: null, onboarding_done: true });
}

/**
 * Verifica si un JID está bloqueado.
 */
async function isBlocked(jid) {
  const contact = await getContact(jid);
  return contact?.blocked === true;
}

/**
 * Bloquea un contacto con razón opcional.
 */
async function blockContact(jid, reason = null) {
  await upsertContact(jid, { blocked: true, block_reason: reason });
}

/**
 * Desbloquea un contacto.
 */
async function unblockContact(jid) {
  await upsertContact(jid, { blocked: false, block_reason: null });
}

/**
 * Lista todos los contactos bloqueados.
 */
async function getBlockedContacts() {
  try {
    const { data, error } = await getSupabase()
      .from('contacts')
      .select('jid, name, block_reason, updated_at')
      .eq('blocked', true);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[ContactsDB] getBlockedContacts error:', err.message);
    return [];
  }
}

module.exports = {
  getContact, upsertContact, setPersonality, createContactIfNew,
  saveOnboardingSession, getOnboardingSessionFromDB, clearOnboardingSession,
  isBlocked, blockContact, unblockContact, getBlockedContacts,
};
