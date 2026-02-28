// Groqbot/src/priceService.js - Servicio de precios (TRM Colombia + Crypto)

// Cache simple para evitar spam a las APIs
const _cache = new Map(); // key -> { data, timestamp }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function _getCached(key) {
  const entry = _cache.get(key);
  if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) return entry.data;
  return null;
}

function _setCache(key, data) {
  _cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Obtiene la TRM (Tasa Representativa del Mercado) del dolar en Colombia.
 * Usa la API publica del Banco de la Republica / exchangerate-api.
 * @returns {{ rate: number, previousRate: number|null, date: string }}
 */
async function getTRM() {
  const cached = _getCached('trm');
  if (cached) return cached;

  try {
    // Intentar con exchangerate-api (gratis, sin key)
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('API error: ' + res.status);
    const data = await res.json();

    if (data.result === 'success' && data.rates?.COP) {
      const result = {
        rate: data.rates.COP,
        previousRate: null, // Esta API no da historico
        date: data.time_last_update_utc || new Date().toISOString(),
        source: 'exchangerate-api',
      };
      _setCache('trm', result);
      return result;
    }
    throw new Error('No COP rate in response');
  } catch (err) {
    console.error('[PriceService] Error obteniendo TRM:', err.message);

    // Fallback: API de datos abiertos Colombia
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res2 = await fetch(`https://www.datos.gov.co/resource/32sa-8pi3.json?$where=vigenciadesde>='${today}'&$limit=1`);
      if (res2.ok) {
        const rows = await res2.json();
        if (rows.length > 0) {
          const result = {
            rate: parseFloat(rows[0].valor),
            previousRate: null,
            date: rows[0].vigenciadesde,
            source: 'datos.gov.co',
          };
          _setCache('trm', result);
          return result;
        }
      }
    } catch (_) {}

    throw new Error('No se pudo obtener la TRM');
  }
}

/**
 * Obtiene el precio de una criptomoneda usando CoinGecko API (gratis).
 * @param {string} coinId - ID de CoinGecko (ej: 'bitcoin', 'ethereum', 'solana')
 * @returns {{ name: string, symbol: string, price_usd: number, change_24h: number, price_cop: number|null }}
 */
async function getCryptoPrice(coinId) {
  const normalizedId = _normalizeCoinId(coinId);
  const cached = _getCached('crypto_' + normalizedId);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${normalizedId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`
    );

    if (res.status === 429) throw new Error('RATE_LIMIT');
    if (!res.ok) throw new Error('Crypto no encontrada: ' + normalizedId);

    const data = await res.json();
    const result = {
      name: data.name,
      symbol: (data.symbol || '').toUpperCase(),
      price_usd: data.market_data?.current_price?.usd || 0,
      change_24h: data.market_data?.price_change_percentage_24h || 0,
      price_cop: data.market_data?.current_price?.cop || null,
      market_cap_usd: data.market_data?.market_cap?.usd || 0,
    };

    _setCache('crypto_' + normalizedId, result);
    return result;
  } catch (err) {
    if (err.message === 'RATE_LIMIT') {
      throw new Error('Limite de consultas alcanzado. Intenta en unos segundos.');
    }
    throw err;
  }
}

/**
 * Busca una crypto por nombre/ticker y devuelve el ID de CoinGecko.
 */
async function searchCrypto(query) {
  const cached = _getCached('search_' + query.toLowerCase());
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.coins && data.coins.length > 0) {
      const result = {
        id: data.coins[0].id,
        name: data.coins[0].name,
        symbol: data.coins[0].symbol?.toUpperCase(),
      };
      _setCache('search_' + query.toLowerCase(), result);
      return result;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Aliases comunes de crypto -> coingecko ID
const COIN_ALIASES = {
  btc: 'bitcoin', bitcoin: 'bitcoin',
  eth: 'ethereum', ethereum: 'ethereum',
  sol: 'solana', solana: 'solana',
  bnb: 'binancecoin',
  xrp: 'ripple', ripple: 'ripple',
  ada: 'cardano', cardano: 'cardano',
  doge: 'dogecoin', dogecoin: 'dogecoin',
  dot: 'polkadot', polkadot: 'polkadot',
  matic: 'matic-network', polygon: 'matic-network',
  avax: 'avalanche-2', avalanche: 'avalanche-2',
  link: 'chainlink', chainlink: 'chainlink',
  uni: 'uniswap', uniswap: 'uniswap',
  atom: 'cosmos', cosmos: 'cosmos',
  ltc: 'litecoin', litecoin: 'litecoin',
  near: 'near', ton: 'the-open-network',
  shib: 'shiba-inu',
  pepe: 'pepe',
  sui: 'sui',
  apt: 'aptos', aptos: 'aptos',
  arb: 'arbitrum', arbitrum: 'arbitrum',
  op: 'optimism', optimism: 'optimism',
};

function _normalizeCoinId(input) {
  const lower = input.toLowerCase().trim();
  return COIN_ALIASES[lower] || lower;
}

/**
 * Formatea un numero grande en formato legible.
 */
function formatUSD(amount) {
  if (amount >= 1_000_000_000) return '$' + (amount / 1_000_000_000).toFixed(2) + 'B';
  if (amount >= 1_000_000) return '$' + (amount / 1_000_000).toFixed(2) + 'M';
  if (amount >= 1000) return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (amount >= 1) return '$' + amount.toFixed(2);
  if (amount >= 0.01) return '$' + amount.toFixed(4);
  return '$' + amount.toFixed(8);
}

function formatCOP(amount) {
  if (amount >= 1_000_000_000) return '$' + (amount / 1_000_000_000).toFixed(1) + 'B';
  if (amount >= 1_000_000) return '$' + (amount / 1_000_000).toFixed(1) + 'M';
  return '$' + Math.round(amount).toLocaleString('es-CO');
}

function formatChangeArrow(pct) {
  if (pct > 0) return '+' + pct.toFixed(2) + '% ↑';
  if (pct < 0) return pct.toFixed(2) + '% ↓';
  return '0.00%';
}

/**
 * Obtiene tasas de cambio para divisas fiat vs USD y COP.
 * @param {string[]} currencies - Códigos ISO: EUR, GBP, JPY, MXN, etc.
 * @returns {{ currency, rateVsUsd, priceCop }[]}
 */
async function getFxRates(currencies) {
  if (!currencies || currencies.length === 0) return [];

  const cached = _getCached('fx_all_rates');
  let rates = cached;

  if (!rates) {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) throw new Error('FX API: ' + res.status);
      const data = await res.json();
      if (data.result !== 'success') throw new Error('FX API bad response');
      rates = data.rates;
      _setCache('fx_all_rates', rates);
    } catch (err) {
      console.error('[PriceService] Error obteniendo FX rates:', err.message);
      return [];
    }
  }

  const copRate = rates.COP || 4200;
  return currencies
    .map(c => c.toUpperCase())
    .filter(c => rates[c])
    .map(c => ({
      currency: c,
      rateVsUsd: 1 / rates[c],       // 1 unidad de divisa = X USD
      priceCop: copRate / rates[c],   // 1 unidad de divisa = X COP
    }));
}

module.exports = {
  getTRM,
  getCryptoPrice,
  getFxRates,
  searchCrypto,
  formatUSD,
  formatCOP,
  formatChangeArrow,
  COIN_ALIASES,
};
