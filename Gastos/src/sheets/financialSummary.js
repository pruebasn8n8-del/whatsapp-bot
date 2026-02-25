const { getDoc } = require('./sheetsClient');
const { getAllConfig } = require('./configManager');
const { getMonthTabName, now } = require('../utils/dateUtils');
const { formatCOP } = require('../utils/formatCurrency');
const { categories } = require('../categories/categoryMap');

async function getFinancialSummary() {
  const cfg = await getAllConfig();
  const tipoBase = cfg['Tipo Base'] || null;
  const salario = cfg['Salario'] || null;
  const saldo = cfg['Saldo Inicial'] || null;
  const metaAhorro = cfg['Meta Ahorro Mensual'] || null;

  const base = tipoBase === 'saldo' ? saldo : salario;
  const baseLabel = tipoBase === 'saldo' ? 'Saldo Inicial' : 'Salario';

  if (!base) {
    return '📊 *Resumen Financiero*\n\nNo has configurado tu ingreso.\nEscribe "salario 5M" o "saldo 2M" para empezar.';
  }

  // Read expenses from month tab
  const doc = await getDoc();
  const tabName = getMonthTabName();
  const sheet = doc.sheetsByTitle[tabName];

  let totalGastado = 0;
  const gastosPorCat = {};

  if (sheet) {
    const rows = await sheet.getRows();
    for (const row of rows) {
      const monto = parseFloat(row.get('Monto')) || 0;
      const cat = row.get('Categoría') || 'Sin Categoría';
      totalGastado += monto;
      gastosPorCat[cat] = (gastosPorCat[cat] || 0) + monto;
    }
  }

  const disponible = base - totalGastado;
  const pctGastado = base > 0 ? Math.round((totalGastado / base) * 100) : 0;
  const pctDisponible = 100 - pctGastado;

  // Days remaining in month
  const hoy = now();
  const diasEnMes = hoy.daysInMonth;
  const diasRestantes = diasEnMes - hoy.day;

  const presupuestoDiario = diasRestantes > 0 ? Math.round(disponible / diasRestantes) : 0;

  let lines = [];
  lines.push(`📊 *Resumen Financiero - ${tabName}*`);
  lines.push('');
  lines.push(`💰 ${baseLabel}: ${formatCOP(base)}`);
  lines.push(`💸 Gastado: ${formatCOP(totalGastado)} (${pctGastado}%)`);
  lines.push(`💵 Disponible: ${formatCOP(disponible)} (${pctDisponible}%)`);

  // Meta de ahorro
  if (metaAhorro) {
    const cumplimiento = disponible >= metaAhorro;
    const pctMeta = base > 0 ? Math.round((metaAhorro / base) * 100) : 0;
    lines.push('');
    lines.push(`🎯 Meta de Ahorro: ${formatCOP(metaAhorro)} (${pctMeta}% del ingreso)`);
    lines.push(`📈 Ahorro Actual: ${formatCOP(disponible)}`);
    if (cumplimiento) {
      lines.push(`✅ Cumplimiento: ${Math.round((disponible / metaAhorro) * 100)}% - Vas bien!`);
    } else {
      const faltante = metaAhorro - disponible;
      lines.push(`⚠ Te faltan ${formatCOP(faltante)} para tu meta`);
    }
  }

  // Presupuesto diario
  lines.push('');
  lines.push(`📅 Días restantes: ${diasRestantes}`);
  if (presupuestoDiario > 0) {
    lines.push(`💡 Presupuesto diario: ${formatCOP(presupuestoDiario)}`);
  } else {
    lines.push(`⚠ Sin presupuesto disponible`);
  }

  // Gastos por categoría
  const catEntries = Object.entries(gastosPorCat).sort((a, b) => b[1] - a[1]);
  if (catEntries.length > 0) {
    lines.push('');
    lines.push('🏷 *Gastos por categoría:*');
    for (const [cat, monto] of catEntries) {
      const pct = base > 0 ? Math.round((monto / base) * 100) : 0;
      lines.push(`  ${cat}: ${formatCOP(monto)} (${pct}%)`);
    }
  }

  // Recomendaciones de ahorro
  const recomendaciones = [];
  for (const [cat, monto] of catEntries) {
    const catInfo = categories.find(c => c.name === cat);
    if (catInfo && catInfo.savingsRate > 0 && catInfo.reducible) {
      const ahorroPosible = Math.round(monto * catInfo.savingsRate);
      if (ahorroPosible >= 1000) {
        recomendaciones.push({ cat, ahorro: ahorroPosible });
      }
    }
  }

  if (recomendaciones.length > 0) {
    lines.push('');
    lines.push('💡 *Ahorro recomendado:*');
    let totalRecomendado = 0;
    for (const r of recomendaciones) {
      lines.push(`  Reducir ${r.cat}: ${formatCOP(r.ahorro)}`);
      totalRecomendado += r.ahorro;
    }
    lines.push(`  *Total posible: ${formatCOP(totalRecomendado)}*`);
  }

  return lines.join('\n');
}

module.exports = { getFinancialSummary };
