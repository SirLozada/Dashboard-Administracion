import { Router } from 'express';
import { z } from 'zod';
import { db, today } from '../../lib/db.js';
import { requireAuth, requirePerm } from '../../lib/auth.js';
import { parse } from '../../lib/errors.js';
import { EPS, round2 } from '../../lib/money.js';
import { optDate } from '../../lib/validate.js';
import { invoiceBalances } from './service.js';

const router = Router();
router.use(requireAuth, requirePerm('reportes.ver'));

router.get('/gastos', async (req, res) => {
  const q = parse(z.object({ desde: optDate.optional(), hasta: optDate.optional() }), req.query);
    const desde = q.desde || '0000-01-01';
  const hasta = q.hasta || '9999-12-31';

  const invoices = await invoiceBalances(`r.status != 'anulada' AND i.invoice_date BETWEEN @desde AND @hasta`, { desde, hasta });
  const depts = new Map((await db.all('SELECT id, name FROM departments')).map((d) => [d.id, d.name]));

  const group = (keyFn, labelFn) => {
    const map = new Map();
    for (const i of invoices) {
      const key = `${keyFn(i)}|${i.currency}`;
      const g = map.get(key) || { key: keyFn(i), label: labelFn(i), currency: i.currency, facturas: 0, facturado: 0, pagado: 0, saldo: 0 };
      g.facturas++;
      g.facturado = round2(g.facturado + i.amount);
      g.pagado = round2(g.pagado + Math.min(i.paid, i.amount));
      g.saldo = round2(g.saldo + i.balance);
      map.set(key, g);
    }
    return [...map.values()].sort((a, b) => b.facturado - a.facturado);
  };

  const approved = await db.all(`
    SELECT r.department_id, d.name AS label, r.currency, COUNT(*) AS requisiciones, ROUND(SUM(r.approved_total), 2) AS aprobado
    FROM requisitions r JOIN departments d ON d.id = r.department_id
    WHERE r.approved_total IS NOT NULL AND substr(r.decided_at, 1, 10) BETWEEN ? AND ?
    GROUP BY r.department_id, d.name, r.currency ORDER BY aprobado DESC`, [desde, hasta]);

  const paidByMonth = await db.all(`
    SELECT substr(p.paid_date, 1, 7) AS mes, i.currency, ROUND(SUM(p.amount), 2) AS pagado, COUNT(*) AS pagos
    FROM payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE p.status = 'realizado' AND p.paid_date BETWEEN ? AND ?
    GROUP BY mes, i.currency ORDER BY mes`, [desde, hasta]);

  const t = today();
  const addDays = (n) => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const open = (await invoiceBalances(`r.status != 'anulada'`)).filter((i) => i.balance > EPS);
  const aging = { vencido: {}, '0-7': {}, '8-30': {}, '31+': {} };
  for (const i of open) {
    const bucket = i.due_date < t ? 'vencido' : i.due_date <= addDays(7) ? '0-7' : i.due_date <= addDays(30) ? '8-30' : '31+';
    aging[bucket][i.currency] = round2((aging[bucket][i.currency] || 0) + i.balance);
  }

  res.json({
    desde: q.desde, hasta: q.hasta,
    por_departamento: group((i) => i.department_id, (i) => depts.get(i.department_id)),
    por_proveedor: group((i) => i.supplier_id, (i) => i.supplier_name),
    aprobado_por_departamento: approved,
    pagos_por_mes: paidByMonth,
    obligaciones: open.map((i) => ({
      id: i.id, requisition_id: i.requisition_id, requisition_number: i.requisition_number, supplier_name: i.supplier_name,
      number: i.number, due_date: i.due_date, currency: i.currency, amount: i.amount, balance: i.balance, payment_status: i.payment_status,
    })),
    antiguedad: aging,
  });
});

export default router;
