import { Router } from 'express';
import { z } from 'zod';
import { getDb, now, today } from '../../lib/db.js';
import { can, requireAuth, requirePerm } from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../../lib/errors.js';
import { discardUpload, storeUpload, uploadSingle } from '../../lib/files.js';
import { EPS, round2 } from '../../lib/money.js';
import { notify, usersWithPermission } from '../../lib/notify.js';
import { getCurrencies, getSetting } from '../../lib/settings.js';
import { txn } from '../../lib/txn.js';
import { bool, date, id, optDate, optId, positiveMoney, money, reqText, text } from '../../lib/validate.js';
import { ESTADOS, GRUPOS, PRIORIDADES } from '../../../shared/constants.js';
import {
  EDITABLE_BY_REQUESTER, EXECUTION, IN_REVIEW, PURCHASABLE, addEvent, assertNotSelf, assertStatus, assertSubmittable,
  canEditAsRequester, effectiveQty, estimatedTotal, invoiceBalances, itemsOf, loadVisible, nextNumber, purchasesTotal,
  reqLink, serializeRequisition, saveItems, syncExecutionStatus, transition, visibilityClause,
} from './service.js';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  id: optId,
  article_id: optId,
  is_unregistered: bool.default(false),
  item_name: text(200),
  category_id: optId,
  unit_id: z.coerce.number({ error: 'Seleccione la unidad de medida.' }).int().positive('Seleccione la unidad de medida.'),
  quantity: z.coerce.number({ error: 'Indique una cantidad válida.' }).positive('La cantidad debe ser mayor que cero.').max(1e9),
  specifications: text(1000),
  description: text(2000),
  reference_file_id: optId,
}).superRefine((v, ctx) => {
  if (v.is_unregistered && v.item_name.length < 2) ctx.addIssue({ code: 'custom', message: 'Indique el nombre del artículo no registrado.', path: ['item_name'] });
  if (!v.is_unregistered && !v.article_id) ctx.addIssue({ code: 'custom', message: 'Seleccione un artículo del catálogo en cada línea.', path: ['article_id'] });
});

const reqSchema = z.object({
  client_token: z.string().trim().max(100).optional(),
  required_date: optDate,
  priority: z.enum(Object.keys(PRIORIDADES), { error: 'Prioridad inválida.' }).default('normal'),
  justification: text(4000),
  items: z.array(itemSchema).max(200, 'Máximo 200 artículos por requisición.').default([]),
  submit: bool.default(false),
});

const commentSchema = z.object({ comment: reqText('La observación', 3, 4000) });

// ---------------------------------------------------------------------------
// Acciones disponibles (el cliente las usa para mostrar botones; el servidor las vuelve a validar)
// ---------------------------------------------------------------------------

function availableActions(user, r, extra) {
  const a = [];
  if (canEditAsRequester(user, r)) a.push('editar', 'enviar', 'anular');
  if (can(user, 'req.revisar')) {
    if (r.status === 'enviada') a.push('recibir', 'devolver_solicitante');
    if (IN_REVIEW.includes(r.status)) a.push('revisar', 'cotizar', 'enviar_administracion', 'devolver_solicitante');
  }
  if (can(user, 'req.aprobar') && r.status === 'pendiente_aprobacion') {
    if (r.reviewed_by !== user.id && r.requester_id !== user.id) a.push('aprobar', 'rechazar', 'devolver');
    else a.push('decision_bloqueada');
  }
  if (can(user, 'compras.ejecutar')) {
    if (r.status === 'aprobada') a.push('iniciar_compra');
    if (PURCHASABLE.includes(r.status) && !r.purchase_completed) a.push('registrar_compra');
    if (r.status === 'compra_parcial' && !r.purchase_completed) a.push('finalizar_compra');
  }
  if (can(user, 'facturas.registrar') && EXECUTION.includes(r.status) && extra.purchases > 0) a.push('cargar_factura');
  if (can(user, 'req.cerrar') && r.status === 'pagada') a.push('cerrar');
  if (can(user, 'catalogo.validar') && r.status !== 'borrador' && extra.pendingCatalog > 0) a.push('validar_catalogo');
  a.push('comentar');
  return a;
}

function detail(user, reqId) {
  const r = loadVisible(user, reqId);
  const db = getDb();
  const extra = {
    purchases: db.prepare('SELECT COUNT(*) FROM purchases WHERE requisition_id = ?').pluck().get(r.id),
    pendingCatalog: db.prepare(`SELECT COUNT(*) FROM requisition_items WHERE requisition_id = ? AND catalog_review = 'pendiente'`).pluck().get(r.id),
  };
  return { ...serializeRequisition(r, user), actions: availableActions(user, r, extra) };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

router.get('/resumen', (req, res) => {
  const user = req.user;
  const db = getDb();
  const vis = visibilityClause(user);
  const rows = db.prepare(`SELECT r.status, COUNT(*) AS n FROM requisitions r WHERE ${vis.sql} GROUP BY r.status`).all(vis.params);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const sum = (list) => list.reduce((a, s) => a + (by[s] || 0), 0);

  const out = {
    por_estado: by,
    solicitante: {
      enviadas: sum(Object.keys(ESTADOS).filter((s) => !['borrador', 'anulada'].includes(s))),
      borradores: by.borrador || 0,
      pendientes: sum(GRUPOS.pendientes),
      devueltas: by.devuelta_solicitante || 0,
      aprobadas: sum(GRUPOS.aprobadas),
      rechazadas: by.rechazada || 0,
      finalizadas: by.cerrada || 0,
    },
  };

  if (can(user, 'req.revisar') || can(user, 'compras.ejecutar')) {
    out.compras = {
      nuevas: by.enviada || 0,
      en_revision: by.en_revision || 0,
      devueltas: (by.devuelta_compras || 0) + (by.devuelta_solicitante || 0),
      devueltas_compras: by.devuelta_compras || 0,
      enviadas_administracion: by.pendiente_aprobacion || 0,
      aprobadas_por_ejecutar: by.aprobada || 0,
      en_proceso: sum(GRUPOS.enCompra),
      pendientes_factura: db.prepare(`SELECT COUNT(DISTINCT p.requisition_id) FROM purchases p JOIN requisitions r ON r.id = p.requisition_id
        WHERE r.status NOT IN ('cerrada','anulada') AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.purchase_id = p.id)`).pluck().get(),
    };
  }

  if (can(user, 'req.ver_finanzas') && can(user, 'req.aprobar')) {
    const invoices = invoiceBalances(`r.status != 'anulada'`);
    const open = invoices.filter((i) => i.balance > EPS);
    const byCurrency = (list, field) => {
      const acc = {};
      for (const i of list) acc[i.currency] = round2((acc[i.currency] || 0) + i[field]);
      return acc;
    };
    // Monto comprometido: lo aprobado y aún no facturado + saldo pendiente de facturas.
    const committed = {};
    const active = db.prepare(`SELECT id, currency, approved_total FROM requisitions WHERE status IN (${GRUPOS.ejecucion.map(() => '?').join(',')})`).all(...GRUPOS.ejecucion);
    for (const r of active) {
      if (!r.currency) continue;
      const inv = invoices.filter((i) => i.requisition_id === r.id);
      const invoicedSame = inv.filter((i) => i.currency === r.currency).reduce((a, i) => a + i.amount, 0);
      const purchased = purchasesTotal(r.id, r.currency);
      const notInvoiced = Math.max(Math.max(r.approved_total || 0, purchased) - invoicedSame, 0);
      if (r.purchase_completed || ['compra_ejecutada', 'facturada', 'pendiente_pago', 'pagada'].includes(r.status)) {
        // Con la compra concluida, lo comprometido sin facturar es lo comprado pendiente de factura.
        committed[r.currency] = round2((committed[r.currency] || 0) + Math.max(purchased - invoicedSame, 0));
      } else {
        committed[r.currency] = round2((committed[r.currency] || 0) + notInvoiced);
      }
    }
    for (const i of open) committed[i.currency] = round2((committed[i.currency] || 0) + i.balance);
    const paidTotals = db.prepare(`SELECT i.currency, ROUND(SUM(p.amount), 2) AS total, COUNT(*) AS n FROM payments p
      JOIN invoices i ON i.id = p.invoice_id WHERE p.status = 'realizado' GROUP BY i.currency`).all();

    out.administracion = {
      pendientes_aprobacion: by.pendiente_aprobacion || 0,
      aprobadas: sum(GRUPOS.aprobadas) + (by.cerrada || 0),
      rechazadas: by.rechazada || 0,
      en_compra: sum(['aprobada', 'en_compra', 'compra_parcial', 'compra_ejecutada']),
      facturas_pendientes: open.filter((i) => i.paid <= EPS && i.scheduled <= EPS).length,
      facturas_vencidas: open.filter((i) => i.payment_status === 'vencido').length,
      pagos_pendientes: open.length,
      pagos_pendientes_monto: byCurrency(open, 'balance'),
      pagos_realizados: paidTotals.reduce((a, p) => a + p.n, 0),
      pagos_realizados_monto: Object.fromEntries(paidTotals.map((p) => [p.currency, p.total])),
      comprometido: committed,
    };
  }
  res.json(out);
});

router.get('/', (req, res) => {
  const user = req.user;
  const q = parse(z.object({
    estado: z.string().max(300).optional(),
    departamento: optId.optional(),
    prioridad: z.enum(Object.keys(PRIORIDADES)).optional().or(z.literal('')),
    desde: optDate.optional(),
    hasta: optDate.optional(),
    buscar: z.string().trim().max(100).optional(),
    mias: bool.optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    por_pagina: z.coerce.number().int().min(5).max(200).default(25),
  }), req.query);

  const vis = visibilityClause(user);
  const where = [vis.sql];
  const params = { ...vis.params };
  if (q.estado) {
    const list = q.estado.split(',').flatMap((s) => GRUPOS[s] || [s]).filter((s) => ESTADOS[s]);
    if (list.length) {
      where.push(`r.status IN (${list.map((_, i) => `@st${i}`).join(',')})`);
      list.forEach((s, i) => { params[`st${i}`] = s; });
    }
  }
  if (q.departamento) { where.push('r.department_id = @dep'); params.dep = q.departamento; }
  if (q.prioridad) { where.push('r.priority = @pri'); params.pri = q.prioridad; }
  if (q.desde) { where.push('substr(r.created_at, 1, 10) >= @desde'); params.desde = q.desde; }
  if (q.hasta) { where.push('substr(r.created_at, 1, 10) <= @hasta'); params.hasta = q.hasta; }
  if (q.mias) { where.push('r.requester_id = @me'); params.me = user.id; }
  if (q.buscar) {
    where.push(`(r.number LIKE @b OR r.justification LIKE @b OR EXISTS (SELECT 1 FROM requisition_items x WHERE x.requisition_id = r.id AND x.item_name LIKE @b))`);
    params.b = `%${q.buscar.replace(/[%_]/g, '')}%`;
  }

  const db = getDb();
  const sqlWhere = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) FROM requisitions r WHERE ${sqlWhere}`).pluck().get(params);
  const rows = db.prepare(`
    SELECT r.id, r.number, r.created_at, r.submitted_at, r.required_date, r.priority, r.status, r.justification,
      r.currency, r.approved_total, r.department_id, d.name AS department_name,
      u.first_name || ' ' || u.last_name AS requester_name,
      (SELECT COUNT(*) FROM requisition_items x WHERE x.requisition_id = r.id) AS items_count,
      (SELECT group_concat(item_name, ', ') FROM (SELECT item_name FROM requisition_items x WHERE x.requisition_id = r.id ORDER BY position LIMIT 3)) AS items_preview,
      (SELECT ROUND(SUM(COALESCE(x.approved_quantity, x.quantity) * x.estimated_unit_price), 2) FROM requisition_items x WHERE x.requisition_id = r.id) AS estimated_total
    FROM requisitions r JOIN departments d ON d.id = r.department_id JOIN users u ON u.id = r.requester_id
    WHERE ${sqlWhere}
    ORDER BY CASE r.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 ELSE 2 END, r.created_at DESC
    LIMIT @limit OFFSET @offset`).all({ ...params, limit: q.por_pagina, offset: (q.pagina - 1) * q.por_pagina });

  const finance = can(user, 'req.ver_finanzas');
  res.json({
    total,
    pagina: q.pagina,
    por_pagina: q.por_pagina,
    items: rows.map((r) => {
      const out = { ...r, status_label: ESTADOS[r.status]?.label };
      if (!finance) { delete out.currency; delete out.approved_total; delete out.estimated_total; }
      return out;
    }),
  });
});

router.get('/:id', (req, res) => {
  res.json(detail(req.user, parse(id, req.params.id)));
});

// ---------------------------------------------------------------------------
// Solicitante: crear, corregir, enviar, anular
// ---------------------------------------------------------------------------

function notifySubmitted(r, user) {
  notify(usersWithPermission('req.revisar'), {
    type: 'nueva_requisicion',
    title: `Nueva requisición ${r.number}`,
    message: `${user.first_name} ${user.last_name} (${user.department_name || 'sin departamento'}) envió una requisición${r.priority !== 'normal' ? ` con prioridad ${PRIORIDADES[r.priority].toLowerCase()}` : ''}.`,
    link: reqLink(r.id),
  }, { exclude: user.id });
}

function submit(r, user) {
  assertSubmittable(r);
  const resubmission = r.status === 'devuelta_solicitante';
  transition(r, 'enviada', user.id, resubmission ? 'reenvio' : 'envio', { extra: { submitted_at: now() } });
  notifySubmitted(r, user);
}

router.post('/', requirePerm('req.crear'), (req, res) => {
  const user = req.user;
  const body = parse(reqSchema, req.body);
  if (!user.department_id) throw badRequest('Su usuario no tiene un departamento asignado. Contacte al administrador del sistema.');
  const db = getDb();

  // Evita duplicados accidentales (doble clic, reintentos por conexión).
  if (body.client_token) {
    const dup = db.prepare('SELECT id FROM requisitions WHERE client_token = ?').get(body.client_token);
    if (dup) {
      const existing = loadVisible(user, dup.id);
      return res.status(200).json({ ...detail(user, existing.id), duplicated: true });
    }
  }

  const newId = txn(() => {
    const ts = now();
    const info = db.prepare(`INSERT INTO requisitions (number, client_token, requester_id, department_id, required_date, priority,
      justification, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?, 'borrador', ?, ?)`)
      .run(nextNumber(), body.client_token || null, user.id, user.department_id, body.required_date, body.priority, body.justification, ts, ts);
    const reqId = Number(info.lastInsertRowid);
    saveItems(reqId, body.items, user);
    addEvent(reqId, user.id, 'creacion', { to: 'borrador' });
    const r = db.prepare('SELECT * FROM requisitions WHERE id = ?').get(reqId);
    if (body.submit) submit(r, user);
    return reqId;
  });
  res.status(201).json(detail(user, newId));
});

router.put('/:id', requirePerm('req.crear'), (req, res) => {
  const user = req.user;
  const body = parse(reqSchema, req.body);
  const reqId = parse(id, req.params.id);
  txn(() => {
    const r = loadVisible(user, reqId);
    if (!canEditAsRequester(user, r)) {
      assertStatus(r, EDITABLE_BY_REQUESTER, 'Solo pueden modificarse borradores o requisiciones devueltas para corrección.');
      throw forbidden();
    }
    getDb().prepare('UPDATE requisitions SET required_date = ?, priority = ?, justification = ?, updated_at = ? WHERE id = ?')
      .run(body.required_date, body.priority, body.justification, now(), r.id);
    saveItems(r.id, body.items, user);
    Object.assign(r, { required_date: body.required_date, priority: body.priority, justification: body.justification });
    if (r.status === 'devuelta_solicitante') addEvent(r.id, user.id, 'correccion', { comment: 'Requisición corregida por el departamento.' });
    if (body.submit) submit(r, user);
  });
  res.json(detail(user, reqId));
});

router.post('/:id/enviar', requirePerm('req.crear'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  txn(() => {
    const r = loadVisible(user, reqId);
    if (!canEditAsRequester(user, r)) throw conflict('La requisición ya fue enviada o no puede enviarse en su estado actual.');
    submit(r, user);
  });
  res.json(detail(user, reqId));
});

router.post('/:id/anular', requirePerm('req.crear'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const { comment } = parse(z.object({ comment: text(1000) }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    if (!canEditAsRequester(user, r)) throw conflict('Solo pueden anularse borradores o requisiciones devueltas.');
    transition(r, 'anulada', user.id, 'anulacion', { comment });
    audit(req, 'anular', 'requisicion', r.id, { number: r.number });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/comentarios', (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const body = parse(commentSchema.extend({ interno: bool.default(false) }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    const internal = body.interno && can(user, 'req.ver_finanzas');
    addEvent(r.id, user.id, 'comentario', { comment: body.comment, financeOnly: internal });
    // Notifica al otro extremo de la conversación.
    const targets = can(user, 'req.revisar') || can(user, 'req.aprobar')
      ? (internal ? [...usersWithPermission('req.revisar'), ...usersWithPermission('req.aprobar')] : [r.requester_id])
      : [r.received_by || r.reviewed_by].filter(Boolean);
    notify(targets.length ? targets : usersWithPermission('req.revisar'), {
      type: 'comentario', title: `Nueva observación en ${r.number}`, message: body.comment.slice(0, 200), link: reqLink(r.id),
    }, { exclude: user.id });
  });
  res.json(detail(user, reqId));
});

// ---------------------------------------------------------------------------
// Compras: recepción, revisión, cotizaciones, devolución y envío a Administración
// ---------------------------------------------------------------------------

router.post('/:id/recibir', requirePerm('req.revisar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, ['enviada'], 'La requisición ya fue recibida por Compras.');
    transition(r, 'en_revision', user.id, 'recepcion', { extra: { received_by: user.id, received_at: now() } });
    notify([r.requester_id], {
      type: 'recibida', title: `Requisición ${r.number} recibida por Compras`,
      message: `${user.first_name} ${user.last_name} inició la revisión.`, link: reqLink(r.id),
    });
  });
  res.json(detail(user, reqId));
});

const reviewSchema = z.object({
  currency: z.string().trim().toUpperCase().max(5).optional().nullable(),
  purchasing_notes: text(4000),
  items: z.array(z.object({
    id,
    approved_quantity: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().nonnegative('Cantidad validada inválida.').max(1e9).nullable()),
    purchasing_comment: text(1000),
    supplier_id: optId,
    estimated_unit_price: z.preprocess((v) => (v === '' || v === undefined ? null : v), money.nullable()),
  })).default([]),
});

function saveReview(r, body, user) {
  const db = getDb();
  if (body.currency && !getCurrencies().includes(body.currency)) throw badRequest('Moneda no habilitada en los parámetros del sistema.');
  db.prepare('UPDATE requisitions SET currency = COALESCE(?, currency), purchasing_notes = ?, updated_at = ? WHERE id = ?')
    .run(body.currency || null, body.purchasing_notes, now(), r.id);
  const itemIds = new Set(db.prepare('SELECT id FROM requisition_items WHERE requisition_id = ?').pluck().all(r.id));
  for (const it of body.items) {
    if (!itemIds.has(it.id)) throw badRequest('Una de las líneas no pertenece a esta requisición.');
    if (it.supplier_id && !db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND active = 1').get(it.supplier_id)) {
      throw badRequest('Uno de los proveedores seleccionados no existe o está inactivo.');
    }
    db.prepare(`UPDATE requisition_items SET approved_quantity = ?, purchasing_comment = ?, supplier_id = ?, estimated_unit_price = ? WHERE id = ?`)
      .run(it.approved_quantity, it.purchasing_comment, it.supplier_id, it.estimated_unit_price, it.id);
  }
}

router.put('/:id/revision', requirePerm('req.revisar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const body = parse(reviewSchema, req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, IN_REVIEW, 'La requisición no está en revisión por Compras.');
    saveReview(r, body, user);
  });
  res.json(detail(user, reqId));
});

router.post('/:id/cotizaciones', requirePerm('req.revisar'), uploadSingle(), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  try {
    const body = parse(z.object({
      supplier_id: id,
      amount: z.preprocess((v) => (v === '' || v === undefined ? null : v), money.nullable()),
      currency: z.string().trim().toUpperCase().max(5).optional(),
      notes: text(1000),
    }), req.body);
    txn(() => {
      const r = loadVisible(user, reqId);
      assertStatus(r, IN_REVIEW, 'Solo pueden adjuntarse cotizaciones durante la revisión de Compras.');
      const supplier = getDb().prepare('SELECT * FROM suppliers WHERE id = ? AND active = 1').get(body.supplier_id);
      if (!supplier) throw badRequest('Seleccione un proveedor activo.');
      if (!req.file && body.amount == null) throw badRequest('Adjunte el documento de la cotización o indique su monto.');
      const currency = body.currency || r.currency || getSetting('moneda_principal');
      if (!getCurrencies().includes(currency)) throw badRequest('Moneda no habilitada.');
      const file = req.file ? storeUpload(req.file, { kind: 'cotizacion', requisitionId: r.id, userId: user.id }) : null;
      getDb().prepare(`INSERT INTO quotations (requisition_id, supplier_id, file_id, amount, currency, notes, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(r.id, supplier.id, file?.id ?? null, body.amount, currency, body.notes, user.id, now());
      addEvent(r.id, user.id, 'cotizacion', {
        comment: `Cotización de ${supplier.name}${body.amount != null ? ` por ${body.amount.toFixed(2)} ${currency}` : ''}.`, financeOnly: true,
      });
    });
  } catch (e) { discardUpload(req.file); throw e; }
  res.status(201).json(detail(user, reqId));
});

router.delete('/:id/cotizaciones/:qid', requirePerm('req.revisar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const qid = parse(id, req.params.qid);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, IN_REVIEW, 'Las cotizaciones solo pueden eliminarse durante la revisión.');
    const q = getDb().prepare('SELECT q.*, s.name AS supplier_name FROM quotations q JOIN suppliers s ON s.id = q.supplier_id WHERE q.id = ? AND q.requisition_id = ?').get(qid, r.id);
    if (!q) throw notFound('Cotización no encontrada.');
    getDb().prepare('DELETE FROM quotations WHERE id = ?').run(q.id);
    addEvent(r.id, user.id, 'cotizacion_eliminada', { comment: `Se eliminó la cotización de ${q.supplier_name}.`, financeOnly: true });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/devolver-solicitante', requirePerm('req.revisar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const { comment } = parse(commentSchema, req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, ['enviada', ...IN_REVIEW]);
    transition(r, 'devuelta_solicitante', user.id, 'devolucion_solicitante', {
      comment, extra: r.received_by ? {} : { received_by: user.id, received_at: now() },
    });
    notify([r.requester_id], {
      type: 'correccion', title: `Corrección solicitada: ${r.number}`, message: comment.slice(0, 200), link: reqLink(r.id),
    });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/enviar-administracion', requirePerm('req.revisar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const body = req.body && Object.keys(req.body).length ? parse(reviewSchema.extend({ comment: text(2000) }), req.body) : null;
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, IN_REVIEW, 'La requisición no está en revisión por Compras.');
    if (body) saveReview(r, body, user);
    const fresh = getDb().prepare('SELECT * FROM requisitions WHERE id = ?').get(r.id);
    if (!fresh.currency) throw badRequest('Seleccione la moneda de la cotización.');
    const items = itemsOf(r.id);
    const toBuy = items.filter((it) => effectiveQty(it) > EPS);
    if (!toBuy.length) throw badRequest('Debe validar al menos un artículo con cantidad mayor que cero.');
    const missing = toBuy.filter((it) => it.estimated_unit_price == null);
    if (missing.length) throw badRequest(`Registre el precio unitario estimado de: ${missing.map((m) => m.item_name).join(', ')}.`);
    const total = estimatedTotal(items);
    const prev = r.status;
    getDb().prepare('UPDATE requisitions SET reviewed_by = ?, reviewed_at = ?, received_by = COALESCE(received_by, ?), received_at = COALESCE(received_at, ?) WHERE id = ?')
      .run(user.id, now(), user.id, now(), r.id);
    addEvent(r.id, user.id, 'revisada', {
      from: prev, comment: [body?.comment, `Total estimado: ${total.toFixed(2)} ${fresh.currency}.`].filter(Boolean).join(' '), financeOnly: true,
    });
    transition(r, 'pendiente_aprobacion', user.id, 'envio_administracion', { comment: body?.comment || '' });
    notify(usersWithPermission('req.aprobar'), {
      type: 'pendiente_aprobacion', title: `Requisición ${r.number} pendiente de aprobación`,
      message: `Revisada por ${user.first_name} ${user.last_name}. Total estimado ${total.toFixed(2)} ${fresh.currency}.`, link: reqLink(r.id),
    }, { exclude: user.id });
    notify([r.requester_id], {
      type: 'revisada', title: `Requisición ${r.number} revisada por Compras`,
      message: 'Fue enviada a Administración para su aprobación.', link: reqLink(r.id),
    });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/items/:itemId/catalogo', requirePerm('catalogo.validar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const itemId = parse(id, req.params.itemId);
  const body = parse(z.object({
    accion: z.enum(['incorporar', 'descartar']),
    name: text(200),
    category_id: optId,
    unit_id: optId,
    code: text(50),
  }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    const db = getDb();
    const it = db.prepare('SELECT * FROM requisition_items WHERE id = ? AND requisition_id = ?').get(itemId, r.id);
    if (!it || !it.is_unregistered) throw notFound('Artículo no registrado no encontrado.');
    if (it.catalog_review !== 'pendiente') throw conflict('Este artículo ya fue validado.');
    if (body.accion === 'descartar') {
      db.prepare(`UPDATE requisition_items SET catalog_review = 'descartado' WHERE id = ?`).run(it.id);
      addEvent(r.id, user.id, 'catalogo', { comment: `"${it.item_name}" no se incorporará al catálogo oficial.` });
      return;
    }
    const categoryId = body.category_id || it.category_id;
    if (!categoryId || !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw badRequest('Seleccione la categoría del catálogo.');
    const name = body.name || it.item_name;
    let article = db.prepare('SELECT * FROM articles WHERE name = ? COLLATE NOCASE AND category_id = ?').get(name, categoryId);
    if (!article) {
      if (body.code && db.prepare('SELECT 1 FROM articles WHERE code = ?').get(body.code)) throw conflict('Ya existe un artículo con ese código.');
      const info = db.prepare(`INSERT INTO articles (code, name, category_id, unit_id, description, active, created_at, updated_at)
        VALUES (?,?,?,?,?,1,?,?)`).run(body.code || null, name, categoryId, body.unit_id || it.unit_id, it.description, now(), now());
      article = { id: Number(info.lastInsertRowid) };
      audit(req, 'crear', 'articulo', article.id, { name, origen: r.number });
    }
    const cat = db.prepare('SELECT name FROM categories WHERE id = ?').pluck().get(categoryId);
    db.prepare(`UPDATE requisition_items SET catalog_review = 'incorporado', article_id = ?, category_id = ?, category_name = ? WHERE id = ?`)
      .run(article.id, categoryId, cat, it.id);
    addEvent(r.id, user.id, 'catalogo', { comment: `"${name}" fue incorporado al catálogo oficial.` });
  });
  res.json(detail(user, reqId));
});

// ---------------------------------------------------------------------------
// Administración: aprobar, rechazar, devolver, cerrar
// ---------------------------------------------------------------------------

function decisionGuard(user, r) {
  assertStatus(r, ['pendiente_aprobacion'], 'La requisición no está pendiente de aprobación.');
  // Segregación de funciones: quien revisó/cotizó o solicitó no puede decidir.
  assertNotSelf(user, r, 'reviewed_by', 'No puede aprobar una requisición que usted mismo revisó y cotizó.');
  assertNotSelf(user, r, 'requester_id', 'No puede decidir sobre una requisición que usted mismo solicitó.');
}

router.post('/:id/aprobar', requirePerm('req.aprobar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const { comment } = parse(z.object({ comment: text(2000) }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    decisionGuard(user, r);
    const total = estimatedTotal(itemsOf(r.id));
    transition(r, 'aprobada', user.id, 'aprobacion', {
      comment, extra: { decided_by: user.id, decided_at: now(), decision_notes: comment, approved_total: total },
    });
    addEvent(r.id, user.id, 'monto_aprobado', { comment: `Monto aprobado: ${total.toFixed(2)} ${r.currency}.`, financeOnly: true });
    audit(req, 'aprobar', 'requisicion', r.id, { number: r.number, total, currency: r.currency });
    const msg = { type: 'aprobada', title: `Requisición ${r.number} aprobada`, message: comment || 'Puede iniciarse la adquisición.', link: reqLink(r.id) };
    notify([r.requester_id], msg);
    notify(usersWithPermission('compras.ejecutar'), msg, { exclude: user.id });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/rechazar', requirePerm('req.aprobar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const { comment } = parse(z.object({ comment: reqText('El motivo del rechazo', 5, 2000) }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    decisionGuard(user, r);
    transition(r, 'rechazada', user.id, 'rechazo', { comment, extra: { decided_by: user.id, decided_at: now(), decision_notes: comment } });
    audit(req, 'rechazar', 'requisicion', r.id, { number: r.number, motivo: comment });
    const msg = { type: 'rechazada', title: `Requisición ${r.number} rechazada`, message: comment.slice(0, 200), link: reqLink(r.id) };
    notify([r.requester_id], msg);
    notify(usersWithPermission('req.revisar'), msg, { exclude: user.id });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/devolver', requirePerm('req.aprobar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const body = parse(z.object({ destino: z.enum(['compras', 'solicitante'], { error: 'Indique a quién se devuelve.' }), comment: reqText('La observación', 5, 2000) }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    decisionGuard(user, r);
    const to = body.destino === 'compras' ? 'devuelta_compras' : 'devuelta_solicitante';
    transition(r, to, user.id, body.destino === 'compras' ? 'devolucion_compras' : 'devolucion_solicitante', { comment: body.comment });
    audit(req, 'devolver', 'requisicion', r.id, { number: r.number, destino: body.destino });
    const targets = body.destino === 'compras' ? [r.reviewed_by, ...usersWithPermission('req.revisar')] : [r.requester_id];
    notify(targets, {
      type: 'correccion', title: `Corrección solicitada por Administración: ${r.number}`, message: body.comment.slice(0, 200), link: reqLink(r.id),
    }, { exclude: user.id });
  });
  res.json(detail(user, reqId));
});

router.post('/:id/cerrar', requirePerm('req.cerrar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const { comment } = parse(z.object({ comment: text(2000) }), req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, ['pagada'], 'Solo pueden cerrarse requisiciones pagadas en su totalidad.');
    transition(r, 'cerrada', user.id, 'cierre', { comment, extra: { closed_by: user.id, closed_at: now() } });
    audit(req, 'cerrar', 'requisicion', r.id, { number: r.number });
    notify([r.requester_id], { type: 'cerrada', title: `Requisición ${r.number} finalizada`, message: 'El proceso fue completado y cerrado.', link: reqLink(r.id) });
  });
  res.json(detail(user, reqId));
});

// ---------------------------------------------------------------------------
// Compras: ejecución de compras y facturas
// ---------------------------------------------------------------------------

router.post('/:id/iniciar-compra', requirePerm('compras.ejecutar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, ['aprobada'], 'Solo pueden iniciarse compras de requisiciones aprobadas.');
    transition(r, 'en_compra', user.id, 'inicio_compra');
  });
  res.json(detail(user, reqId));
});

const purchaseSchema = z.object({
  supplier_id: z.coerce.number({ error: 'Seleccione el proveedor.' }).int().positive('Seleccione el proveedor.'),
  purchase_date: date,
  currency: z.string().trim().toUpperCase().max(5),
  notes: text(2000),
  items: z.array(z.object({
    requisition_item_id: id,
    quantity: z.coerce.number().positive('La cantidad adquirida debe ser mayor que cero.'),
    unit_price: money,
  })).min(1, 'Indique al menos un artículo adquirido.'),
});

router.post('/:id/compras', requirePerm('compras.ejecutar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const body = parse(purchaseSchema, req.body);
  if (body.purchase_date > today()) throw badRequest('La fecha de compra no puede ser futura.');
  txn(() => {
    const db = getDb();
    const r = loadVisible(user, reqId);
    // No se ejecutan compras sin aprobación vigente.
    assertStatus(r, PURCHASABLE, 'Solo pueden registrarse compras de requisiciones aprobadas y en proceso de compra.');
    if (r.purchase_completed) throw conflict('La compra de esta requisición ya fue finalizada.');
    if (body.currency !== r.currency) throw badRequest(`La compra debe registrarse en la moneda aprobada (${r.currency}).`);
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ? AND active = 1').get(body.supplier_id);
    if (!supplier) throw badRequest('Seleccione un proveedor activo.');

    const items = new Map(itemsOf(r.id).map((it) => [it.id, it]));
    const seen = new Set();
    let total = 0;
    for (const line of body.items) {
      const it = items.get(line.requisition_item_id);
      if (!it) throw badRequest('Una de las líneas no pertenece a esta requisición.');
      if (seen.has(it.id)) throw badRequest(`"${it.item_name}" está repetido en la compra.`);
      seen.add(it.id);
      const remaining = effectiveQty(it) - it.purchased_quantity;
      if (line.quantity > remaining + EPS) {
        throw badRequest(`La cantidad de "${it.item_name}" supera lo aprobado (pendiente por adquirir: ${round2(Math.max(remaining, 0))} ${it.unit_name}).`);
      }
      total += line.quantity * line.unit_price;
    }
    total = round2(total);
    const tol = Number(getSetting('tolerancia_sobrecosto_pct')) || 0;
    const limit = round2((r.approved_total || 0) * (1 + tol / 100));
    const cumulative = round2(purchasesTotal(r.id, r.currency) + total);
    if (cumulative > limit + EPS) {
      throw conflict(`El total comprado (${cumulative.toFixed(2)} ${r.currency}) superaría el monto aprobado más la tolerancia de ${tol}% (${limit.toFixed(2)} ${r.currency}). Se requiere una nueva aprobación de Administración.`);
    }

    if (r.status === 'aprobada') transition(r, 'en_compra', user.id, 'inicio_compra');
    const info = db.prepare(`INSERT INTO purchases (requisition_id, supplier_id, purchase_date, currency, notes, created_by, created_at)
      VALUES (?,?,?,?,?,?,?)`).run(r.id, supplier.id, body.purchase_date, body.currency, body.notes, user.id, now());
    const purchaseId = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO purchase_items (purchase_id, requisition_item_id, quantity, unit_price) VALUES (?,?,?,?)');
    for (const line of body.items) ins.run(purchaseId, line.requisition_item_id, line.quantity, line.unit_price);
    addEvent(r.id, user.id, 'compra_registrada', { comment: `Compra a ${supplier.name} por ${total.toFixed(2)} ${body.currency} (${body.items.length} artículo(s)).`, financeOnly: true });
    audit(req, 'registrar_compra', 'requisicion', r.id, { number: r.number, purchaseId, total });
    syncExecutionStatus(r.id, user.id);
  });
  res.status(201).json(detail(user, reqId));
});

router.post('/:id/finalizar-compra', requirePerm('compras.ejecutar'), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  const { comment } = parse(commentSchema, req.body);
  txn(() => {
    const r = loadVisible(user, reqId);
    assertStatus(r, ['compra_parcial'], 'Solo puede finalizarse una compra parcial.');
    getDb().prepare('UPDATE requisitions SET purchase_completed = 1, updated_at = ? WHERE id = ?').run(now(), r.id);
    addEvent(r.id, user.id, 'compra_finalizada', { comment: `Compra finalizada con cantidades parciales. ${comment}` });
    syncExecutionStatus(r.id, user.id);
  });
  res.json(detail(user, reqId));
});

router.post('/:id/facturas', requirePerm('facturas.registrar'), uploadSingle(), (req, res) => {
  const user = req.user;
  const reqId = parse(id, req.params.id);
  try {
    const body = parse(z.object({
      purchase_id: z.coerce.number({ error: 'Seleccione la compra asociada.' }).int().positive('Seleccione la compra asociada.'),
      number: reqText('El número de factura', 1, 60),
      invoice_date: date,
      due_date: optDate,
      amount: positiveMoney,
      currency: z.string().trim().toUpperCase().max(5),
      notes: text(2000),
    }), req.body);
    if (body.invoice_date > today()) throw badRequest('La fecha de factura no puede ser futura.');
    if (!req.file) throw badRequest('Adjunte el archivo de la factura (PDF, JPG o PNG).');
    if (!getCurrencies().includes(body.currency)) throw badRequest('Moneda no habilitada.');
    txn(() => {
      const db = getDb();
      const r = loadVisible(user, reqId);
      assertStatus(r, EXECUTION, 'Solo pueden cargarse facturas de compras registradas.');
      const purchase = db.prepare('SELECT p.*, s.name AS supplier_name FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ? AND p.requisition_id = ?').get(body.purchase_id, r.id);
      if (!purchase) throw badRequest('La compra seleccionada no pertenece a esta requisición.');
      if (db.prepare('SELECT 1 FROM invoices WHERE supplier_id = ? AND number = ?').get(purchase.supplier_id, body.number)) {
        throw conflict(`La factura N.º ${body.number} de ${purchase.supplier_name} ya está registrada.`);
      }
      let due = body.due_date;
      if (!due) {
        const d = new Date(`${body.invoice_date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + (Number(getSetting('dias_credito')) || 0));
        due = d.toISOString().slice(0, 10);
      }
      if (due < body.invoice_date) throw badRequest('La fecha de vencimiento no puede ser anterior a la fecha de factura.');
      const file = storeUpload(req.file, { kind: 'factura', requisitionId: r.id, userId: user.id });
      const info = db.prepare(`INSERT INTO invoices (requisition_id, purchase_id, supplier_id, number, invoice_date, due_date, amount, currency, file_id, notes, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id, purchase.id, purchase.supplier_id, body.number, body.invoice_date, due, body.amount, body.currency, file.id, body.notes, user.id, now());
      addEvent(r.id, user.id, 'factura_registrada', {
        comment: `Factura N.º ${body.number} de ${purchase.supplier_name} por ${body.amount.toFixed(2)} ${body.currency}, vence el ${due}.`, financeOnly: true,
      });
      audit(req, 'registrar_factura', 'factura', Number(info.lastInsertRowid), { requisicion: r.number, number: body.number, amount: body.amount });
      syncExecutionStatus(r.id, user.id);
      notify(usersWithPermission('pagos.gestionar'), {
        type: 'factura', title: `Factura registrada: ${r.number}`,
        message: `N.º ${body.number} de ${purchase.supplier_name} por ${body.amount.toFixed(2)} ${body.currency}.`, link: '/pagos',
      }, { exclude: user.id });
    });
  } catch (e) { discardUpload(req.file); throw e; }
  res.status(201).json(detail(user, reqId));
});

export default router;
