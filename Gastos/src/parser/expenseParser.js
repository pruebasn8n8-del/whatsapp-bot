const { parseAmount } = require('./amountParser');

// Regex to find amounts in the message: numbers with optional dots/commas/k suffix
const AMOUNT_REGEX = /\$?[\d]+(?:[.,]\d{3})*k?|\$?[\d]+(?:[.,]\d+)?k/gi;

function parseExpense(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  // Find all potential amounts
  const amountMatches = trimmed.match(AMOUNT_REGEX);
  if (!amountMatches) return null;

  // Try to parse each match, take the first valid one
  let amount = null;
  let amountMatch = null;
  for (const m of amountMatches) {
    const parsed = parseAmount(m);
    if (parsed !== null) {
      amount = parsed;
      amountMatch = m;
      break;
    }
  }

  if (amount === null) return null;

  // Extract tag (#tag)
  let tag = null;
  const tagMatch = trimmed.match(/#(\w+)/);
  if (tagMatch) {
    tag = tagMatch[1].toLowerCase();
  }

  // Remove the amount and tag from text to get description parts
  let remaining = trimmed
    .replace(amountMatch, ' ')
    .replace(/#\w+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!remaining) return null;

  // The description is the remaining text
  // If there are words after the amount position, they might be a category hint
  const parts = remaining.split(/\s+/);
  const description = parts[0]; // First word is the main description
  const categoryHint = parts.length > 1 ? parts.slice(1).join(' ') : null;

  return {
    description: capitalize(description),
    amount,
    categoryHint: categoryHint ? categoryHint.toLowerCase() : null,
    tag,
    raw: trimmed,
  };
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

module.exports = { parseExpense };
