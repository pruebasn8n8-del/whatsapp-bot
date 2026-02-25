const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', '..', 'learned-categories.json');

function loadAll() {
  try {
    const data = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function getLearnedCategory(keyword) {
  const learned = loadAll();
  const key = keyword.toLowerCase().trim();
  return learned[key] || null;
}

function saveLearnedCategory(keyword, categoryName) {
  const learned = loadAll();
  learned[keyword.toLowerCase().trim()] = categoryName;
  fs.writeFileSync(FILE_PATH, JSON.stringify(learned, null, 2), 'utf8');
}

module.exports = { getLearnedCategory, saveLearnedCategory };
