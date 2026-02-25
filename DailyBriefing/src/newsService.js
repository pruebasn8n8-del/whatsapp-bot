// DailyBriefing/src/newsService.js - Servicio de noticias

// Cache de las ultimas noticias para poder expandirlas con /noticia <num>
let _lastNews = [];

/**
 * Obtiene noticias principales de Colombia.
 * Fuente principal: Google News RSS (mejores titulares locales)
 * Fallback: NewsAPI
 * @param {number} count - Numero de noticias (default: 5)
 * @returns {Array<{ title: string, source: string, url: string, description: string }>}
 */
async function getNews(count = 5) {
  let news = [];

  // Google News RSS primero (mejores noticias de Colombia)
  try {
    news = await _fetchGoogleNewsRSS(count);
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
 * Retorna las ultimas noticias cacheadas.
 */
function getLastNews() {
  return _lastNews;
}

/**
 * Obtiene una noticia con su URL real resuelta.
 * @param {number} index - Indice (0-based)
 */
async function getExpandedNews(index) {
  if (index < 0 || index >= _lastNews.length) return null;
  const news = { ..._lastNews[index] };

  // Resolver URL si todavia es redirect de Google News
  if (news.url && news.url.includes('news.google.com')) {
    try {
      const realUrl = await _resolveRedirectUrl(news.url);
      if (realUrl) news.url = realUrl;
    } catch (_) {}
  }

  return news;
}

async function _fetchNewsAPI(apiKey, count) {
  // top-headlines con pais
  let res = await fetch(
    `https://newsapi.org/v2/top-headlines?country=co&pageSize=${count}&apiKey=${apiKey}`
  );
  let data = await res.json();

  // Si no hay resultados, usar everything
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
    }));
  }
  return [];
}

async function _fetchGoogleNewsRSS(count) {
  const res = await fetch('https://news.google.com/rss?hl=es-419&gl=CO&ceid=CO:es-419');
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

  // Resolver URLs de Google News en paralelo
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

    // Intentar extraer del HTML si hay redirect JS o meta refresh
    const html = await res.text();
    const metaMatch = html.match(/content="\d+;url=(https?:\/\/[^"]+)"/i);
    if (metaMatch) return metaMatch[1];

    // Buscar link data-n-au (atributo de Google News para URL del articulo)
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
 */
function formatNews(news) {
  if (!news || news.length === 0) return null;

  const lines = news.map((n, i) => {
    const src = n.source ? ` _(${n.source})_` : '';
    return `${i + 1}. ${n.title}${src}`;
  });

  return '📰 *Noticias destacadas*\n' + lines.join('\n') + '\n\n_/noticia <num> para mas info_';
}

module.exports = { getNews, getLastNews, getExpandedNews, formatNews };
