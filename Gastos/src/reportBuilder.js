// Gastos/src/reportBuilder.js — generador de HTML para el reporte mensual de gastos
const { getDoc } = require('./sheets/sheetsClient');
const { getAllConfig } = require('./sheets/configManager');
const { getMonthTabName } = require('./utils/dateUtils');
const { formatCOP } = require('./utils/formatCurrency');

/**
 * Genera el HTML completo del reporte mensual.
 * Requiere que sheetsClient ya tenga el spreadsheetId del usuario seteado.
 * @returns {{ html: string, tabName: string }}
 */
async function buildMonthlyReportHtml() {
  const cfg = await getAllConfig();
  const tabName = getMonthTabName();
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle[tabName];

  let rows = [];
  if (sheet) {
    const rawRows = await sheet.getRows();
    rows = rawRows.map(r => ({
      fecha: r.get('Fecha') || '',
      descripcion: r.get('Descripción') || r.get('Descripcion') || '',
      monto: parseFloat(r.get('Monto')) || 0,
      categoria: r.get('Categoría') || r.get('Categoria') || 'Sin categoría',
    }));
  }

  const totalGastado = rows.reduce((s, r) => s + r.monto, 0);
  const salario = parseFloat(cfg['Salario']) || 0;
  const metaAhorro = parseFloat(cfg['Meta Ahorro Mensual']) || 0;
  const disponible = salario - totalGastado;

  const porCat = {};
  rows.forEach(r => { porCat[r.categoria] = (porCat[r.categoria] || 0) + r.monto; });
  const catRows = Object.entries(porCat)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, monto]) => `<tr><td>${cat}</td><td style="text-align:right">${formatCOP(monto)}</td></tr>`)
    .join('');

  const expenseRows = rows.slice(0, 50)
    .map(r => `<tr><td>${r.fecha}</td><td>${r.descripcion}</td><td>${r.categoria}</td><td style="text-align:right">${formatCOP(r.monto)}</td></tr>`)
    .join('');

  const pctGastado = salario > 0 ? Math.round((totalGastado / salario) * 100) : 0;
  const barColor = pctGastado > 90 ? '#e74c3c' : pctGastado > 70 ? '#f39c12' : '#27ae60';

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; margin: 30px; color: #222; font-size: 13px; }
  h1 { color: #2c3e50; font-size: 22px; margin-bottom: 4px; }
  .subtitle { color: #7f8c8d; margin-bottom: 20px; }
  .summary { display: flex; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
  .card { background: #f8f9fa; border-radius: 8px; padding: 14px 20px; min-width: 150px; }
  .card .label { font-size: 11px; color: #7f8c8d; text-transform: uppercase; }
  .card .value { font-size: 18px; font-weight: bold; margin-top: 4px; }
  .progress-wrap { margin-bottom: 24px; }
  .progress-bar { background: #e0e0e0; border-radius: 4px; height: 14px; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; background: ${barColor}; width: ${Math.min(pctGastado, 100)}%; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { background: #2c3e50; color: #fff; text-align: left; padding: 7px 10px; font-size: 12px; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; }
  tr:nth-child(even) td { background: #f9f9f9; }
  h2 { color: #2c3e50; font-size: 15px; margin: 20px 0 8px; border-bottom: 2px solid #eee; padding-bottom: 4px; }
  .footer { color: #aaa; font-size: 11px; margin-top: 30px; text-align: center; }
</style></head><body>
<h1>Reporte de Gastos — ${tabName}</h1>
<p class="subtitle">Generado por Cortana · ${new Date().toLocaleDateString('es-CO')}</p>
<div class="summary">
  <div class="card"><div class="label">Total Gastado</div><div class="value" style="color:#e74c3c">${formatCOP(totalGastado)}</div></div>
  ${salario > 0 ? `<div class="card"><div class="label">Salario</div><div class="value">${formatCOP(salario)}</div></div>` : ''}
  ${salario > 0 ? `<div class="card"><div class="label">Disponible</div><div class="value" style="color:${disponible >= 0 ? '#27ae60' : '#e74c3c'}">${formatCOP(disponible)}</div></div>` : ''}
  ${metaAhorro > 0 ? `<div class="card"><div class="label">Meta Ahorro</div><div class="value" style="color:#3498db">${formatCOP(metaAhorro)}</div></div>` : ''}
</div>
${salario > 0 ? `<div class="progress-wrap">
  <p style="margin:0 0 6px"><strong>${pctGastado}%</strong> del presupuesto utilizado</p>
  <div class="progress-bar"><div class="progress-fill"></div></div>
</div>` : ''}
${catRows ? `<h2>Por Categoría</h2><table><thead><tr><th>Categoría</th><th>Total</th></tr></thead><tbody>${catRows}</tbody></table>` : ''}
${expenseRows ? `<h2>Transacciones del mes (máx. 50)</h2><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Monto</th></tr></thead><tbody>${expenseRows}</tbody></table>` : '<p><em>No hay gastos registrados este mes.</em></p>'}
<p class="footer">Cortana · Bot de Finanzas · ${tabName}</p>
</body></html>`;

  return { html, tabName };
}

module.exports = { buildMonthlyReportHtml };
