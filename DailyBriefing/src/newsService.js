// DailyBriefing/src/newsService.js - Servicio de noticias con soporte de temas

// Cache de las últimas noticias para poder expandirlas con /noticia <num>
let _lastNews = [];

// URLs de Google News RSS por tema
const TOPIC_URLS = {
  colombia:       'https://news.google.com/rss?hl=es-CO&gl=CO&ceid=CO:es-CO',
  internacional:  'https://news.google.com/rss/headlines/section/topic/WORLD?hl=es-419&gl=CO&ceid=CO:es-419',
  tecnologia:     'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=es-419&gl=CO&ceid=CO:es-419',
  deportes:       'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=es-419&gl=CO&ceid=CO:es-419',
  economia:       'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=es-419&gl=CO&ceid=CO:es-419',
  entretenimiento:'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=es-419&gl=CO&ceid=CO:es-419',
};

/**
 * Obtiene noticias de múltiples temas e intercala los resultados.
 * @param {string[]} topics - Temas a incluir (ver TOPIC_URLS)
 * @param {number} totalCount - Total de noticias a devolver
 * @returns {Array<{ title, source, url, description, topic }>}
 */
async function getNewsByTopics(topics = ['colombia', 'internacional'], totalCount = 5) {
  const validTopics = topics.filter(t => TOPIC_URLS[t]);
  if (validTopics.length === 0) validTopics.push('colombia');

  // Fetch múltiples topics en paralelo; pedir más de los necesarios para intercalar bien
  const perTopic = Math.max(3, Math.ceil(totalCount * 1.5 / validTopics.length));

  const results = await Promise.allSettled(
    validTopics.map(async (topic) => {
      try {
        const items = await _fetchGoogleNewsRSSFromUrl(TOPIC_URLS[topic], perTopic);
        return items.map(item => ({ ...item, topic }));
      } catch (err) {
        console.error(`[News] Error obteniendo topic "${topic}":`, err.message);
        return [];
      }
    })
  );

  // Recoger todos los resultados
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // Interleave: 1 noticia de cada tema por turno hasta completar totalCount
  const byTopic = {};
  for (const t of validTopics) byTopic[t] = all.filter(i => i.topic === t);

  const mixed = [];
  while (mixed.length < totalCount) {
    let added = false;
    for (const t of validTopics) {
      if (byTopic[t].length > 0 && mixed.length < totalCount) {
        mixed.push(byTopic[t].shift());
        added = true;
      }
    }
    if (!added) break;
  }

  _lastNews = mixed;
  return mixed;
}

/**
 * Obtiene noticias (wrapper backward-compatible, usa solo Colombia).
 * Tiene fallback a NewsAPI si Google News falla.
 * @param {number} count - Número de noticias
 */
async function getNews(count = 5) {
  let news = [];

  try {
    news = await _fetchGoogleNewsRSSFromUrl(TOPIC_URLS.colombia, count);
  } catch (err) {
    console.error('[News] Google News RSS error:', err.message);
  }

  // Fallback: NewsAPI
  if (news.length === 0) {
    const newsApiKey = process.env.NEWS_API_KEY;
    if (newsApiKey) {
      try {
        news = await _fetchNewsAPI(newsApiKey, count);
      } catch (err) {
        console.error('[News] NewsAPI error:', err.message);
      }
    }
  }

  _lastNews = news;
  return news;
}

/**
 * Retorna las últimas noticias cacheadas.
 */
function getLastNews() {
  return _lastNews;
}

/**
 * Obtiene una noticia con su URL real resuelta.
 * @param {number} index - Índice (0-based)
 */
async function getExpandedNews(index) {
  if (index < 0 || index >= _lastNews.length) return null;
  const news = { ..._lastNews[index] };

  if (news.url && news.url.includes('news.google.com')) {
    try {
      const realUrl = await _resolveRedirectUrl(news.url);
      if (realUrl) news.url = realUrl;
    } catch (_) {}
  }

  return news;
}

async function _fetchNewsAPI(apiKey, count) {
  let res = await fetch(
    `https://newsapi.org/v2/top-headlines?country=co&pageSize=${count}&apiKey=${apiKey}`
  );
  let data = await res.json();

  if (!data.articles || data.articles.length === 0) {
    res = await fetch(
      `https://newsapi.org/v2/everything?q=Colombia&language=es&sortBy=publishedAt&pageSize=${count}&apiKey=${apiKey}`
    );
    data = await res.json();
  }

  if (data.articles && data.articles.length > 0) {
    return data.articles.slice(0, count).map(a => ({
      title: _cleanText(a.title?.split(' - ')[0] || a.title || ''),
      source: a.source?.name || '',
      url: a.url || '',
      description: _cleanText(a.description || ''),
      topic: 'colombia',
    }));
  }
  return [];
}

/**
 * Fetch Google News RSS desde una URL específica.
 */
async function _fetchGoogleNewsRSSFromUrl(url, count) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Google News RSS HTTP ' + res.status);
  const xml = await res.text();

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < count) {
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const sourceMatch = itemXml.match(/<source[^>]*url="([^"]*)"[^>]*>(.*?)<\/source>/);
    const linkMatch = itemXml.match(/<link\/>\s*(https?:\/\/[^\s<]+)|<link>(.*?)<\/link>/);

    if (titleMatch) {
      const rawTitle = (titleMatch[1] || titleMatch[2] || '').trim();
      const cleanTitle = rawTitle.split(' - ').slice(0, -1).join(' - ') || rawTitle;
      const googleUrl = linkMatch ? (linkMatch[1] || linkMatch[2] || '').trim() : '';

      items.push({
        title: cleanTitle.substring(0, 120),
        source: sourceMatch ? sourceMatch[2].trim() : '',
        url: googleUrl,
        description: '',
      });
    }
  }

  // Resolver URLs en paralelo
  console.log('[News] Resolviendo URLs de', items.length, 'noticias...');
  await Promise.allSettled(
    items.map(async (item) => {
      if (item.url && item.url.includes('news.google.com')) {
        try {
          const realUrl = await _resolveRedirectUrl(item.url);
          if (realUrl) item.url = realUrl;
        } catch (_) {}
      }
    })
  );

  return items;
}

/**
 * Sigue redirects para obtener la URL final real.
 */
async function _resolveRedirectUrl(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);

    const finalUrl = res.url;
    if (finalUrl && !finalUrl.includes('news.google.com') && !finalUrl.includes('consent.google')) {
      return finalUrl;
    }

    const html = await res.text();
    const metaMatch = html.match(/content="\d+;url=(https?:\/\/[^"]+)"/i);
    if (metaMatch) return metaMatch[1];

    const dataMatch = html.match(/data-n-au="(https?:\/\/[^"]+)"/);
    if (dataMatch) return dataMatch[1];

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Limpia texto de HTML entities y tags.
 */
function _cleanText(text) {
  return text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Formatea noticias para el briefing.
 * Muestra el tema si hay múltiples topics.
 */
function formatNews(news) {
  if (!news || news.length === 0) return null;

  const { TOPIC_LABELS } = (() => {
    try { return require('../../src/prefsDb'); } catch (_) { return { TOPIC_LABELS: {} }; }
  })();

  // Detectar si hay múltiples temas
  const topics = [...new Set(news.map(n => n.topic).filter(Boolean))];
  const showTopic = topics.length > 1;

  const lines = news.map((n, i) => {
    const src = n.source ? ` _(${n.source})_` : '';
    const topicTag = showTopic && n.topic ? ` [${TOPIC_LABELS[n.topic] || n.topic}]` : '';
    return `${i + 1}. ${n.title}${src}${topicTag}`;
  });

  return '📰 *Noticias destacadas*\n' + lines.join('\n') + '\n\n_/noticia <num> para más info_';
}

module.exports = { getNews, getNewsByTopics, getLastNews, getExpandedNews, formatNews, TOPIC_URLS };
