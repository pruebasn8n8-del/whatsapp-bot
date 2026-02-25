// src/supabaseAuthState.js
// Auth state de Baileys persistido en Supabase.
// Reemplaza useMultiFileAuthState para deployments sin filesystem persistente (HF Spaces, etc.)

const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

let _supabase = null;

function getClient() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return _supabase;
}

async function readData(key) {
  try {
    const { data, error } = await getClient()
      .from('auth_sessions')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    return JSON.parse(data.value, BufferJSON.reviver);
  } catch (err) {
    console.error('[SupabaseAuth] readData error:', err.message);
    return null;
  }
}

async function writeData(key, data) {
  try {
    await getClient()
      .from('auth_sessions')
      .upsert(
        { key, value: JSON.stringify(data, BufferJSON.replacer), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
  } catch (err) {
    console.error('[SupabaseAuth] writeData error:', err.message);
  }
}

async function removeData(key) {
  try {
    await getClient().from('auth_sessions').delete().eq('key', key);
  } catch (err) {
    console.error('[SupabaseAuth] removeData error:', err.message);
  }
}

async function useSupabaseAuthState() {
  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              tasks.push(
                value
                  ? writeData(`${category}-${id}`, value)
                  : removeData(`${category}-${id}`)
              );
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData('creds', creds),
  };
}

module.exports = { useSupabaseAuthState };
