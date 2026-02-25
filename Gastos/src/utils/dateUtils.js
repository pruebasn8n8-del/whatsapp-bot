const { DateTime } = require('luxon');
const config = require('../../config/default');

const tz = config.timezone;

function now() {
  return DateTime.now().setZone(tz);
}

function getMonthTabName(dt) {
  dt = dt || now();
  return dt.toFormat('yyyy-MM');
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

module.exports = { now, getMonthTabName, getFormattedDate, getFormattedTime, getDayOfWeek };
