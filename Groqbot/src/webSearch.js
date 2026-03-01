// Groqbot/src/webSearch.js
// Búsqueda web con cadena de fallbacks:
//   1. Brave Search API  (BRAVE_SEARCH_KEY en env — recomendado, 2k req/mes gratis)
//   2. DDG Instant Answer API  (sin key, respuestas directas/Wikipedia)
//   3. SearXNG público  (sin key, rotación de instancias)
//   4. DuckDuckGo HTML scraping  (último recurso)

const TIMEOUT_MS = 10000;
const MAX_RESULTS = 5;

// ──────────────────────────────────────────────
// 1. Brave Search API  (mejor calidad, requiere key gratuita)
//    https://brave.com/search/api/  → plan gratuito: 2000 req/mes
// ──────────────────────────────────────────────
async function searchBrave(query) {
  const key = process.env.BRAVE_SEARCH_KEY;
  if (!key) throw new Error('BRAVE_SEARCH_KEY no configurada');

  const url = 'https://api.search.brave.com/res/v1/web/search?' +
    new URLSearchParams({ q: query, count: MAX_RESULTS, text_decorations: '0', search_lang: 'es', country: 'CO' });

  const res = await fetch(url, {
    headers: { 'X-Subscription-Token': key, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = await res.json();
  const items = data.web?.results || [];
  if (!items.length) throw new Error('Brave: sin resultados');

  return items.map(r => ({ title: r.title, snippet: r.description || '', url: r.url }));
}

// ──────────────────────────────────────────────
// 2. DuckDuckGo Instant Answer API  (sin key, bueno para respuestas directas)
// ──────────────────────────────────────────────
async function searchDDGInstant(query) {
  const url = 'https://api.duckduckgo.com/?' +
    new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1', no_redirect: '1' });

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DDG IA HTTP ${res.status}`);
  const data = await res.json();

  const results = [];

  // Respuesta directa
  if (data.Answer) {
    results.push({ title: 'Respuesta directa', snippet: data.Answer, url: data.AbstractURL || '' });
  }
  // Resumen principal
  if (data.AbstractText) {
    results.push({ title: data.AbstractSource || 'Fuente', snippet: data.AbstractText, url: data.AbstractURL || '' });
  }
  // Temas relacionados
  for (const t of (data.RelatedTopics || [])) {
    if (results.length >= MAX_RESULTS) break;
    if (t.Text && t.FirstURL) {
      results.push({ title: t.Text.split(' - ')[0] || t.Text, snippet: t.Text, url: t.FirstURL });
    }
  }

  if (!results.length) throw new Error('DDG IA: sin resultados');
  return results;
}

// ──────────────────────────────────────────────
// 3. SearXNG público  (sin key, JSON API)
//    Rota entre varias instancias para evitar bloqueos
// ──────────────────────────────────────────────
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.disroot.org',
  'https://paulgo.io',
  'https://searx.tiekoetter.com',
  'https://searxng.site',
];

async function searchSearXNG(query) {
  const errors = [];
  for (const base of SEARXNG_INSTANCES) {
    try {
      const url = `${base}/search?` + new URLSearchParams({ q: query, format: 'json', language: 'es-CO', safesearch: '0' });
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Bot/1.0)', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = (data.results || []).slice(0, MAX_RESULTS);
      if (!items.length) throw new Error('sin resultados');
      console.log(`[WebSearch] SearXNG (${base}): ${items.length} resultados`);
      return items.map(r => ({ title: r.title, snippet: r.content || '', url: r.url }));
    } catch (e) {
      errors.push(`${base}: ${e.message}`);
    }
  }
  throw new Error('SearXNG: todos fallaron — ' + errors.join(' | '));
}

// ──────────────────────────────────────────────
// 4. DuckDuckGo HTML scraping  (último recurso)
// ──────────────────────────────────────────────
const DDG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'identity',
  'Cache-Control': 'no-cache',
};

async function searchDDGScrape(query) {
  // Intentar con DDG HTML
  const url = 'https://html.duckduckgo.com/html/?' + new URLSearchParams({ q: query, kl: 'co-es' });
  const res = await fetch(url, { headers: DDG_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`DDG HTML ${res.status}`);
  const html = await res.text();

  const results = [];

  // Patrón actualizado para DDG HTML 2024+
  // Los resultados están en <div class="result__body">
  const bodyMatches = html.matchAll(/<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)<\/div>/g);
  for (const bm of bodyMatches) {
    if (results.length >= MAX_RESULTS) break;
    const block = bm[1];

    // Extraer title + URL
    const aMatch = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/);
    if (!aMatch) continue;
    let linkUrl = aMatch[1];
    const title = aMatch[2].replace(/<[^>]+>/g, '').trim();

    // Decodificar redirect DDG
    const uddg = linkUrl.match(/uddg=([^&]+)/);
    if (uddg) linkUrl = decodeURIComponent(uddg[1]);
    if (!linkUrl.startsWith('http')) continue;

    // Snippet
    const snipMatch = block.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snipMatch ? snipMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    if (title) results.push({ title, snippet: snippet.substring(0, 300), url: linkUrl });
  }

  // Fallback: buscar cualquier result__a
  if (!results.length) {
    const linkMatches = html.matchAll(/<a[^>]*class=['"]result__a['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g);
    for (const m of linkMatches) {
      if (results.length >= MAX_RESULTS) break;
      let linkUrl = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      const uddg = linkUrl.match(/uddg=([^&]+)/);
      if (uddg) linkUrl = decodeURIComponent(uddg[1]);
      if (title && linkUrl.startsWith('http')) results.push({ title, snippet: '', url: linkUrl });
    }
  }

  if (!results.length) throw new Error('DDG scraping: sin resultados');
  return results;
}

// ──────────────────────────────────────────────
// Función principal: prueba backends en orden
// ──────────────────────────────────────────────
async function webSearch(query) {
  if (!query || typeof query !== 'string') return 'No pude completar la búsqueda.';
  query = query.trim().substring(0, 200);

  // 1. Brave (si hay key)
  if (process.env.BRAVE_SEARCH_KEY) {
    try {
      const results = await searchBrave(query);
      console.log(`[WebSearch] Brave: ${results.length} resultados`);
      return formatResults(query, results);
    } catch (e) {
      console.warn('[WebSearch] Brave falló:', e.message);
    }
  }

  // 2. DDG Instant Answer
  try {
    const results = await searchDDGInstant(query);
    console.log(`[WebSearch] DDG IA: ${results.length} resultados`);
    return formatResults(query, results);
  } catch (e) {
    console.warn('[WebSearch] DDG IA falló:', e.message);
  }

  // 3. SearXNG público
  try {
    const results = await searchSearXNG(query);
    return formatResults(query, results);
  } catch (e) {
    console.warn('[WebSearch] SearXNG falló:', e.message);
  }

  // 4. DDG HTML scraping
  try {
    const results = await searchDDGScrape(query);
    console.log(`[WebSearch] DDG scraping: ${results.length} resultados`);
    return formatResults(query, results);
  } catch (e) {
    console.warn('[WebSearch] DDG scraping falló:', e.message);
  }

  console.warn('[WebSearch] Todos los backends fallaron para:', query);
  return 'No pude completar la búsqueda en este momento. Responde con tu conocimiento disponible.';
}

function formatResults(query, results) {
  const lines = results.map((r, i) => {
    const parts = [`[${i + 1}] ${r.title}`];
    if (r.snippet) parts.push(r.snippet);
    if (r.url) parts.push('Fuente: ' + r.url);
    return parts.join('\n');
  });
  return `Resultados para: "${query}"\nFecha: ${new Date().toLocaleDateString('es-CO')}\n\n${lines.join('\n\n')}`;
}

// Definición de la herramienta para Groq tool calling
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Busca información actual en internet. Úsalo cuando el usuario pregunte sobre eventos recientes, noticias, precios actuales, resultados deportivos, clima, lanzamientos, personas, tendencias, o cualquier dato que pueda haber cambiado. También úsalo si no estás seguro de la respuesta.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'La consulta de búsqueda. Puede ser en español o inglés según lo más relevante.',
        },
      },
      required: ['query'],
    },
  },
};

module.exports = { webSearch, WEB_SEARCH_TOOL };
