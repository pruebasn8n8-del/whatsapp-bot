function parseAmount(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let str = raw.trim().toLowerCase();

  // Remove $ prefix if present
  str = str.replace(/^\$/, '');

  // Handle "m" suffix: 5m → 5000000, 1.5m → 1500000
  if (str.endsWith('m')) {
    const num = parseFloat(str.slice(0, -1).replace(/,/g, '.'));
    if (isNaN(num)) return null;
    return Math.round(num * 1000000);
  }

  // Handle "k" suffix: 15k → 15000, 1.5k → 1500
  if (str.endsWith('k')) {
    const num = parseFloat(str.slice(0, -1).replace(/,/g, '.'));
    if (isNaN(num)) return null;
    return Math.round(num * 1000);
  }

  // Remove thousands separators (dots or commas used as thousands)
  // "15.000" or "15,000" → 15000
  str = str.replace(/[.,]/g, '');

  const num = parseInt(str, 10);
  return isNaN(num) || num <= 0 ? null : num;
}

module.exports = { parseAmount };
