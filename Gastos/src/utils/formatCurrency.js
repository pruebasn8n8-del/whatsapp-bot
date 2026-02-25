function formatCOP(amount) {
  return '$' + Math.round(amount).toLocaleString('es-CO');
}

module.exports = { formatCOP };
