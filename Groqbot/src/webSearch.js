// src/webSearch.js
// Busqueda web via DuckDuckGo Lite (sin API key)

const MAX_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 12000;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-CO,es;q=0.9,en;q=0.8",
  "Accept-Encoding": "identity",
};

/**
 * Busca en DuckDuckGo HTML lite (principal).
 */
async function searchDDGLite(query) {
  const url = "https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query);

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("DDG HTTP " + response.status);
  }

  const html = await response.text();
  const results = [];

  // DDG Lite: <a rel="nofollow" href="..." class='result-link'>Title</a>
  const linkMatches = html.matchAll(/<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g);
  for (const match of linkMatches) {
    if (results.length >= MAX_RESULTS) break;
    let linkUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();

    // Filtrar ads
    if (linkUrl.includes("duckduckgo.com/y.js") || linkUrl.includes("ad_provider")) continue;

    // Extraer URL real del redirect /l/?uddg=
    const uddgMatch = linkUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      linkUrl = decodeURIComponent(uddgMatch[1]);
    } else if (linkUrl.startsWith("//")) {
      linkUrl = "https:" + linkUrl;
    }

    // Buscar snippet en el td posterior
    const linkPos = html.indexOf(match[0]);
    const afterLink = html.substring(linkPos + match[0].length, linkPos + match[0].length + 1000);
    const snippetMatch = afterLink.match(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    if (title && linkUrl && linkUrl.startsWith("http")) {
      results.push({ title, snippet: snippet.substring(0, 300), url: linkUrl });
    }
  }

  return results;
}

/**
 * Busca en DuckDuckGo HTML normal como fallback.
 */
async function searchDDGHtml(query) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);

  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("DDG HTML HTTP " + response.status);
  }

  const html = await response.text();
  const results = [];

  // DDG HTML: <a class="result__a" href="...">Title</a>
  const linkMatches = html.matchAll(/<a[^>]*class=['"]result__a['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/g);
  for (const match of linkMatches) {
    if (results.length >= MAX_RESULTS) break;
    let linkUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();

    // Extraer URL real del redirect
    const uddgMatch = linkUrl.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      linkUrl = decodeURIComponent(uddgMatch[1]);
    }

    // Buscar snippet
    const linkPos = html.indexOf(match[0]);
    const afterLink = html.substring(linkPos, linkPos + 2000);
    const snippetMatch = afterLink.match(/<a[^>]*class=['"]result__snippet['"][^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    if (title && linkUrl && linkUrl.startsWith("http")) {
      results.push({ title, snippet: snippet.substring(0, 300), url: linkUrl });
    }
  }

  // Fallback: href before class pattern
  if (results.length === 0) {
    const altMatches = html.matchAll(/<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]result__a['"][^>]*>([\s\S]*?)<\/a>/g);
    for (const match of altMatches) {
      if (results.length >= MAX_RESULTS) break;
      let linkUrl = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      const uddgMatch = linkUrl.match(/uddg=([^&]+)/);
      if (uddgMatch) linkUrl = decodeURIComponent(uddgMatch[1]);
      if (title && linkUrl && linkUrl.startsWith("http")) {
        results.push({ title, snippet: "", url: linkUrl });
      }
    }
  }

  return results;
}

/**
 * Busca en internet y retorna resultados formateados.
 * DDG Lite primero, DDG HTML como fallback.
 * @param {string} query
 * @returns {string} Resultados formateados para el modelo
 */
async function webSearch(query) {
  // DDG Lite (principal - mas ligero y rapido)
  try {
    const results = await searchDDGLite(query);
    if (results.length > 0) {
      console.log("[WebSearch] DDG Lite: " + results.length + " resultados");
      return formatResults(query, results);
    }
  } catch (error) {
    console.log("[WebSearch] DDG Lite fallo:", error.message);
  }

  // Fallback: DDG HTML
  try {
    const results = await searchDDGHtml(query);
    if (results.length > 0) {
      console.log("[WebSearch] DDG HTML: " + results.length + " resultados");
      return formatResults(query, results);
    }
  } catch (error) {
    console.log("[WebSearch] DDG HTML fallo:", error.message);
  }

  console.log("[WebSearch] Todos los backends fallaron");
  return "No pude completar la busqueda. Responde con tu conocimiento disponible.";
}

function formatResults(query, results) {
  const formatted = results.map((r, i) => {
    const parts = [`[${i + 1}] ${r.title}`];
    if (r.snippet) parts.push(r.snippet);
    parts.push("Fuente: " + r.url);
    return parts.join("\n");
  });

  return "Resultados de busqueda para: \"" + query + "\"\nFecha: " +
    new Date().toLocaleDateString("es-CO") + "\n\n" + formatted.join("\n\n");
}

// Definicion de la herramienta para Groq tool calling
const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Busca informacion actual en internet. Usa esta herramienta cuando el usuario pregunte sobre: eventos recientes, noticias, precios actuales, resultados deportivos, clima, lanzamientos, personas, tendencias, o cualquier dato que pueda haber cambiado despues de diciembre 2023. Tambien usalo si no estas seguro de la respuesta.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "La consulta de busqueda. Puede ser en espanol o ingles segun lo mas relevante.",
        },
      },
      required: ["query"],
    },
  },
};

module.exports = { webSearch, searchDDGLite, searchDDGHtml, WEB_SEARCH_TOOL };
