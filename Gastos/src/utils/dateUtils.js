const { DateTime } = require('luxon');
const config = require('../../config/default');

const tz = config.timezone;

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MONTH_ALIASES = {
  'enero': 1, 'ene': 1, 'january': 1, 'jan': 1,
  'febrero': 2, 'feb': 2, 'february': 2,
  'marzo': 3, 'mar': 3, 'march': 3,
  'abril': 4, 'abr': 4, 'april': 4, 'apr': 4,
  'mayo': 5, 'may': 5,
  'junio': 6, 'jun': 6, 'june': 6,
  'julio': 7, 'jul': 7, 'july': 7,
  'agosto': 8, 'ago': 8, 'august': 8, 'aug': 8,
  'septiembre': 9, 'sep': 9, 'sept': 9, 'september': 9,
  'octubre': 10, 'oct': 10, 'october': 10,
  'noviembre': 11, 'nov': 11, 'november': 11,
  'diciembre': 12, 'dic': 12, 'december': 12, 'dec': 12,
};

function now() {
  return DateTime.now().setZone(tz);
}

/** Devuelve el nombre de la pestaña del mes: "Febrero 2026" */
function getMonthTabName(dt) {
  dt = dt || now();
  return `${MONTH_NAMES[dt.month - 1]} ${dt.year}`;
}

function getFormattedDate(dt) {
  dt = dt || now();
  return dt.toFormat('yyyy-MM-dd');
}

function getFormattedTime(dt) {
  dt = dt || now();
  return dt.toFormat('HH:mm:ss');
}

function getDayOfWeek(dt) {
  dt = dt || now();
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  return days[dt.weekday - 1];
}

/**
 * Parsea un string de mes en lenguaje natural y devuelve el nombre de pestaña.
 * Soporta: "enero", "feb", "enero 2025", "2026-01"
 * @returns {{ tabName: string, dt: DateTime } | null}
 */
function parseMonthInput(str) {
  if (!str) return null;
  str = str.trim().toLowerCase();

  // Formato ISO: "2026-01" o "2026-1"
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]);
    const month = parseInt(isoMatch[2]);
    if (month >= 1 && month <= 12) {
      const dt = DateTime.fromObject({ year, month, day: 1 }, { zone: tz });
      return { tabName: `${MONTH_NAMES[month - 1]} ${year}`, dt };
    }
  }

  // Formato "enero 2025" o solo "enero" (usa año actual)
  const monthYearMatch = str.match(/^([a-záéíóúüñ]+)\s*(\d{4})?$/);
  if (monthYearMatch) {
    const monthNum = MONTH_ALIASES[monthYearMatch[1]];
    if (monthNum) {
      const year = monthYearMatch[2] ? parseInt(monthYearMatch[2]) : now().year;
      const dt = DateTime.fromObject({ year, month: monthNum, day: 1 }, { zone: tz });
      return { tabName: `${MONTH_NAMES[monthNum - 1]} ${year}`, dt };
    }
  }

  return null;
}

module.exports = { now, getMonthTabName, getFormattedDate, getFormattedTime, getDayOfWeek, parseMonthInput, MONTH_NAMES };
