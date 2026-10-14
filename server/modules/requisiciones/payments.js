import { Router } from 'express';
import { z } from 'zod';
import { db, now, today } from '../../lib/db.js';
import { can, requireAuth, requirePerm } from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors.js';
import { discardUpload, storeUpload, uploadSingle } from '../../lib/files.js';
import { EPS, round2 } from '../../lib/money.js';
import { notify, usersWithPermission } from '../../lib/notify.js';
import { txn } from '../../lib/txn.js';
import { bool, date, id, optDate, optId, positiveMoney, reqText, text } from '../../lib/validate.js';
import { METODOS_PAGO } from '../../../shared/constants.js';
import { addEvent, invoiceBalances, reqLink, syncExecutionStatus } from './service.js';

const router = Router();
router.use(requireAuth, requirePerm('pagos.gestionar'));

async function invoiceDetail(invoiceId) {
  // Dentro de una transacción se bloquea la factura para evitar pagos simultáneos sobre el mismo saldo.
  if (db.inTx()) await db.get('SELECT id FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]);
  const [inv] = await invoiceBalances('i.id = @id', { id: invoiceId });
  if (!inv) throw notFound('Factura no encontrada.');
    const f = await db.get('SELECT uuid, original_name FROM files WHERE id = ?', [inv.file_id]);
  const payments = (await db.all(`
    SELECT p.*, f.uuid AS file_uuid, f.original_name AS file_name,
      cu.first_name || ' ' || cu.last_name AS created_by_name, uu.first_name || ' ' || uu.last_name AS updated_by_name
    FROM payments p LEFT JOIN files f ON f.id = p.file_id
    JOIN users cu ON cu.id = p.created_by LEFT JOIN users uu ON uu.id = p.updated_by
    WHERE p.invoice_id = ? ORDER BY COALESCE(p.paid_date, p.scheduled_date), p.id`, [inv.id]))
    .map((p) => ({ ...p, extraordinary: !!p.extraordinary, file_url: p.file_uuid ? `/api/archivos/${p.file_uuid}` : null }));
  const purchase = inv.purchase_id ? await db.get('SELECT purchase_date, currency FROM purchases WHERE id = ?', [inv.purchase_id]) : null;
  return { ...inv, file_url: f ? `/api/archivos/${f.uuid}` : null, file_name: f?.original_name, purchase, payments };
}

router.get('/', async (req, res) => {
  const q = parse(z.object({
    estado: z.string().max(100).optional(),
    proveedor: optId.optional(),
    departamento: optId.optional(),
    buscar: z.string().trim().max(100).optional(),
    desde: optDate.optional(),
    hasta: optDate.optional(),
  }), req.query);
  const where = [`r.status != 'anulada'`];
  const params = {};
  if (q.proveedor) { where.push('i.supplier_id = @prov'); params.prov = q.proveedor; }
  if (q.departamento) { where.push('r.department_id = @dep'); params.dep = q.departamento; }
  if (q.desde) { where.push('i.invoice_date >= @desde'); params.desde = q.desde; }
  if (q.hasta) { where.push('i.invoice_date <= @hasta'); params.hasta = q.hasta; }
  if (q.buscar) { where.push('(i.number LIKE @b OR r.number LIKE @b OR s.name LIKE @b)'); params.b = `%${q.buscar.replace(/[%_]/g, '')}%`; }
  let rows = await invoiceBalances(where.join(' AND '), params);
  if (q.estado) {
    const states = q.estado.split(',');
    rows = rows.filter((r) => states.includes(r.payment_status) || (states.includes('abiertas') && r.balance > EPS));
  }
  res.json({ items: rows, metodos: METODOS_PAGO });
});

router.get('/facturas/:id', async (req, res) => {
  res.json(await invoiceDetail(parse(id, req.params.id)));
});

async function afterPaymentChange(inv, user) {
  await syncExecutionStatus(inv.requisition_id, user.id);
}

router.post('/facturas/:id/programar', async (req, res) => {
  const user = req.user;
  const invoiceId = parse(id, req.params.id);
  const body = parse(z.object({
    amount: positiveMoney,
    scheduled_date: date,
    method: z.enum(Object.keys(METODOS_PAGO), { error: 'Seleccione el método de pago.' }),
    notes: text(1000),
  }), req.body);
  await txn(async () => {
    const inv = await invoiceDetail(invoiceId);
    const available = round2(inv.balance - inv.scheduled);
    if (body.amount > available + EPS) {
      throw badRequest(`El monto programado supera el saldo disponible por programar (${available.toFixed(2)} ${inv.currency}).`);
    }
    const info = await db.run(`INSERT INTO payments (invoice_id, status, amount, scheduled_date, method, notes, created_by, created_at)
      VALUES (?, 'programado', ?, ?, ?, ?, ?, ?) RETURNING id`, [inv.id, body.amount, body.scheduled_date, body.method, body.notes, user.id, now()]);
    await addEvent(inv.requisition_id, user.id, 'pago_programado', {
      comment: `Pago programado de ${body.amount.toFixed(2)} ${inv.currency} para el ${body.scheduled_date} (factura N.º ${inv.number}).`, financeOnly: true,
    });
    await audit(req, 'programar_pago', 'pago', info.id, { factura: inv.number, amount: body.amount });
  });
  res.status(201).json(await invoiceDetail(invoiceId));
});

router.post('/facturas/:id/pagos', uploadSingle(), async (req, res) => {
  const user = req.user;
  const invoiceId = parse(id, req.params.id);
  try {
    const body = parse(z.object({
      amount: positiveMoney,
      paid_date: date,
      method: z.enum(Object.keys(METODOS_PAGO), { error: 'Seleccione el método de pago.' }),
      reference: reqText('La referencia del pago', 1, 120),
      notes: text(1000),
      scheduled_payment_id: optId,
      extraordinary: bool.default(false),
      extraordinary_reason: text(1000),
    }), req.body);
    if (body.paid_date > today()) throw badRequest('La fecha de pago no puede ser futura.');
    await txn(async () => {
            const inv = await invoiceDetail(invoiceId);
      let extraordinary = false;
      if (body.amount > inv.balance + EPS) {
        // Pago superior al saldo: requiere permiso individual y justificación, y queda auditado.
        if (!body.extraordinary) {
          throw conflict(`El monto (${body.amount.toFixed(2)}) supera el saldo pendiente de ${inv.balance.toFixed(2)} ${inv.currency}. Se requiere autorización extraordinaria.`);
        }
        if (!can(user, 'pagos.sobrepago')) throw forbidden('No tiene autorización para registrar pagos superiores al saldo. Solicítela al Superadministrador.');
        if (body.extraordinary_reason.length < 10) throw badRequest('Justifique la autorización extraordinaria (mínimo 10 caracteres).');
        extraordinary = true;
      }
      if (await db.get(`SELECT 1 FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.supplier_id = ? AND p.reference = ? AND p.status = 'realizado' AND p.method = ?`, [inv.supplier_id, body.reference, body.method])) {
        throw conflict('Ya existe un pago registrado con esa referencia para este proveedor. Verifique que no esté duplicado.');
      }
      const file = req.file ? await storeUpload(req.file, { kind: 'comprobante', requisitionId: inv.requisition_id, userId: user.id }) : null;
      let paymentId;
      if (body.scheduled_payment_id) {
        const sp = await db.get(`SELECT * FROM payments WHERE id = ? AND invoice_id = ? AND status = 'programado'`, [body.scheduled_payment_id, inv.id]);
        if (!sp) throw badRequest('La programación seleccionada no existe o ya fue ejecutada.');
        await db.run(`UPDATE payments SET status = 'realizado', amount = ?, paid_date = ?, method = ?, reference = ?, notes = ?,
          file_id = ?, extraordinary = ?, extraordinary_reason = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [body.amount, body.paid_date, body.method, body.reference, [sp.notes, body.notes].filter(Boolean).join(' | '), file?.id ?? null, extraordinary ? 1 : 0, extraordinary ? body.extraordinary_reason : '', user.id, now(), sp.id]);
        paymentId = sp.id;
      } else {
        const info = await db.run(`INSERT INTO payments (invoice_id, status, amount, paid_date, method, reference, notes, file_id,
          extraordinary, extraordinary_reason, created_by, created_at) VALUES (?, 'realizado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [inv.id, body.amount, body.paid_date, body.method, body.reference, body.notes, file?.id ?? null, extraordinary ? 1 : 0, extraordinary ? body.extraordinary_reason : '', user.id, now()]);
        paymentId = info.id;
      }
      // Ajusta programaciones que excedan el nuevo saldo.
      const newBalance = round2(inv.balance - body.amount);
      if (newBalance <= EPS) {
        await db.run(`UPDATE payments SET status = 'anulado', notes = notes || ' (anulado: factura pagada)', updated_by = ?, updated_at = ? WHERE invoice_id = ? AND status = 'programado'`, [user.id, now(), inv.id]);
      }
      await addEvent(inv.requisition_id, user.id, 'pago_realizado', {
        comment: `Pago de ${body.amount.toFixed(2)} ${inv.currency} a ${inv.supplier_name} (factura N.º ${inv.number}, ref. ${body.reference})${extraordinary ? ' — AUTORIZACIÓN EXTRAORDINARIA' : ''}.`,
        financeOnly: true,
      });
      await audit(req, extraordinary ? 'pago_extraordinario' : 'registrar_pago', 'pago', paymentId, {
        factura: inv.number, requisicion: inv.requisition_number, amount: body.amount, saldo_previo: inv.balance,
        ...(extraordinary ? { motivo: body.extraordinary_reason } : {}),
      });
      await afterPaymentChange(inv, user);
      const msg = {
        type: 'pago', title: `Pago realizado: ${inv.requisition_number}`,
        message: `${body.amount.toFixed(2)} ${inv.currency} a ${inv.supplier_name}, factura N.º ${inv.number}.`, link: reqLink(inv.requisition_id),
      };
      await notify(await usersWithPermission('compras.ejecutar'), msg, { exclude: user.id });
      if (extraordinary) {
        await notify(await usersWithPermission('admin.auditoria'), { ...msg, type: 'pago_extraordinario', title: `Pago extraordinario autorizado: ${inv.requisition_number}` }, { exclude: user.id });
      }
    });
  } catch (e) { discardUpload(req.file); throw e; }
  res.status(201).json(await invoiceDetail(invoiceId));
});

router.post('/programaciones/:id/anular', async (req, res) => {
  const user = req.user;
  const pid = parse(id, req.params.id);
  const { comment } = parse(z.object({ comment: reqText('El motivo', 3, 500) }), req.body);
  let invoiceId;
  await txn(async () => {
        const p = await db.get(`SELECT p.*, i.requisition_id, i.number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?`, [pid]);
    if (!p) throw notFound('Programación no encontrada.');
    if (p.status !== 'programado') throw conflict('Solo pueden anularse pagos programados.');
    await db.run(`UPDATE payments SET status = 'anulado', notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`, [[p.notes, `Anulado: ${comment}`].filter(Boolean).join(' | '), user.id, now(), p.id]);
    await addEvent(p.requisition_id, user.id, 'pago_programado_anulado', { comment: `Se anuló la programación de ${p.amount.toFixed(2)} (factura N.º ${p.number}): ${comment}`, financeOnly: true });
    await audit(req, 'anular_programacion', 'pago', p.id, { motivo: comment });
    invoiceId = p.invoice_id;
  });
  res.json(await invoiceDetail(invoiceId));
});

export default router;
