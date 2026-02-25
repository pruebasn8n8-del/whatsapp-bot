const { categories, defaultCategory } = require('./categoryMap');
const { getLearnedCategory } = require('./learnedCategories');

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove accents
}

function categorize(description, categoryHint) {
  const textToMatch = normalize([description, categoryHint].filter(Boolean).join(' '));

  // 1. Check learned categories first
  const learnedName = getLearnedCategory(description);
  if (learnedName) {
    const found = categories.find((c) => c.name === learnedName);
    if (found) return found;
  }

  // 2. Static keyword match
  for (const cat of categories) {
    for (const keyword of cat.keywords) {
      if (textToMatch.includes(normalize(keyword))) {
        return cat;
      }
    }
  }

  return defaultCategory;
}

module.exports = { categorize };
