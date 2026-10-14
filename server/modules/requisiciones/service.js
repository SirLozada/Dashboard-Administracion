import { db, now } from '../../lib/db.js';
import { can } from '../../lib/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { EPS, round2 } from '../../lib/money.js';
import { getSetting } from '../../lib/settings.js';
import { ESTADOS } from '../../../shared/constants.js';

export const EDITABLE_BY_REQUESTER = ['borrador', 'devuelta_solicitante'];
export const IN_REVIEW = ['en_revision', 'devuelta_compras'];
export const EXECUTION = ['en_compra', 'compra_parcial', 'compra_ejecutada', 'facturada', 'pendiente_pago', 'pagada'];
export const PURCHASABLE = ['aprobada', 'en_compra', 'compra_parcial'];

export const fullName = (first, last) => (first ? `${first} ${last}` : null);
export const reqLink = (id) => `/requisiciones/${id}`;

// ---------------------------------------------------------------------------
// Visibilidad
// ---------------------------------------------------------------------------

/** Condición SQL (alias `r`) con las requisiciones visibles para el usuario. */
export function visibilityClause(user) {
  // Los borradores solo son visibles para el departamento que los elabora.
  const ownDept = '(r.department_id = @vis_dept OR r.requester_id = @vis_user)';
  if (can(user, 'req.ver_todas')) {
    return { sql: `(r.status != 'borrador' OR ${ownDept})`, params: { vis_dept: user.department_id ?? -1, vis_user: user.id } };
  }
  if (can(user, 'req.ver_departamento')) {
    return { sql: ownDept, params: { vis_dept: user.department_id ?? -1, vis_user: user.id } };
  }
  return { sql: 'r.requester_id = @vis_user', params: { vis_user: user.id } };
}

export function canView(user, r) {
  const ownDept = r.department_id === user.department_id || r.requester_id === user.id;
  if (can(user, 'req.ver_todas')) return r.status !== 'borrador' || ownDept;
  if (can(user, 'req.ver_departamento')) return ownDept;
  return r.requester_id === user.id;
}

export const canEditAsRequester = (user, r) =>
  can(user, 'req.crear') && EDITABLE_BY_REQUESTER.includes(r.status) &&
  (r.department_id === user.department_id || r.requester_id === user.id);

/** Lee la requisición; dentro de una transacción bloquea la fila para serializar cambios concurrentes. */
export async function getRequisition(id) {
  const r = await db.get(`SELECT * FROM requisitions WHERE id = ?${db.inTx() ? ' FOR UPDATE' : ''}`, [Number(id)]);
  if (!r) throw notFound('La requisición no existe.');
  return r;
}

/** Carga la requisición verificando que el usuario pueda verla. */
export async function loadVisible(user, id) {
  const r = await getRequisition(id);
  if (!canView(user, r)) throw notFound('La requisición no existe o no tiene acceso a ella.');
  return r;
}

export function assertStatus(r, allowed, msg) {
  if (!allowed.includes(r.status)) {
    throw conflict(msg || `Acción no permitida: la requisición está en estado "${ESTADOS[r.status]?.label || r.status}".`);
  }
}

// ---------------------------------------------------------------------------
// Numeración, eventos y cambios de estado
// ---------------------------------------------------------------------------

export async function nextNumber() {
  const year = new Date().getFullYear();
  const n = await db.value(`INSERT INTO counters (name, value) VALUES (?, 1)
    ON CONFLICT (name) DO UPDATE SET value = counters.value + 1 RETURNING value`, [`req-${year}`]);
  const prefix = ((await getSetting('req_prefijo')) || 'REQ').trim();
  return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
}

export async function addEvent(reqId, userId, action, { from = null, to = null, comment = '', financeOnly = false } = {}) {
  await db.run(`INSERT INTO requisition_events (requisition_id, user_id, action, from_status, to_status, comment, finance_only, created_at)
    VALUES (?,?,?,?,?,?,?,?)`, [reqId, userId, action, from, to, comment || '', financeOnly ? 1 : 0, now()]);
}

/**
 * Cambia el estado con control de concurrencia: solo actualiza si el estado actual coincide con
 * el leído. Evita dobles transiciones por clics repetidos o usuarios simultáneos.
 */
export async function transition(r, to, userId, action, { comment = '', extra = {} } = {}) {
  const sets = ['status = @to', 'updated_at = @now'];
  for (const k of Object.keys(extra)) sets.push(`${k} = @${k}`);
  const res = await db.run(`UPDATE requisitions SET ${sets.join(', ')} WHERE id = @id AND status = @from`,
    { ...extra, to, now: now(), id: r.id, from: r.status });
  if (res.changes !== 1) throw conflict('La requisición fue modificada por otro usuario. Actualice la página e intente de nuevo.');
  await addEvent(r.id, userId, action, { from: r.status, to, comment });
  r.status = to;
}

// ---------------------------------------------------------------------------
// Totales y estado de ejecución
// ---------------------------------------------------------------------------

export const effectiveQty = (it) => (it.approved_quantity ?? it.quantity);

export function itemsOf(reqId) {
  return db.all(`
    SELECT ri.*, s.name AS supplier_name,
      COALESCE((SELECT SUM(pi.quantity) FROM purchase_items pi WHERE pi.requisition_item_id = ri.id), 0) AS purchased_quantity
    FROM requisition_items ri LEFT JOIN suppliers s ON s.id = ri.supplier_id
    WHERE ri.requisition_id = ? ORDER BY ri.position, ri.id`, [reqId]);
}

export function estimatedTotal(items) {
  let total = 0;
  for (const it of items) if (it.estimated_unit_price != null) total += effectiveQty(it) * it.estimated_unit_price;
  return round2(total);
}

export async function purchasesTotal(reqId, currency) {
  return round2(await db.value(`
    SELECT COALESCE(SUM(pi.quantity * pi.unit_price), 0) FROM purchase_items pi
    JOIN purchases p ON p.id = pi.purchase_id WHERE p.requisition_id = ? AND p.currency = ?`, [reqId, currency]));
}

export async function invoiceBalances(where = '1=1', params = {}) {
  const rows = await db.all(`
    SELECT i.*, s.name AS supplier_name, r.number AS requisition_number, r.department_id,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'realizado'), 0) AS paid,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'programado'), 0) AS scheduled,
      (SELECT MIN(scheduled_date) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'programado') AS next_scheduled_date
    FROM invoices i
    JOIN suppliers s ON s.id = i.supplier_id
    JOIN requisitions r ON r.id = i.requisition_id
    WHERE ${where} ORDER BY i.due_date, i.id`, params);
  return rows.map(withPaymentStatus);
}

export function withPaymentStatus(inv) {
  const balance = round2(inv.amount - inv.paid);
  let payment_status;
  if (balance <= EPS) payment_status = 'pagado';
  else if (inv.due_date < new Date().toISOString().slice(0, 10)) payment_status = 'vencido';
  else if (inv.paid > EPS) payment_status = 'parcial';
  else if (inv.scheduled > EPS) payment_status = 'programado';
  else payment_status = 'pendiente';
  return { ...inv, paid: round2(inv.paid), scheduled: round2(inv.scheduled), balance: Math.max(balance, 0), overpaid: balance < -EPS ? round2(-balance) : 0, payment_status };
}

/** Recalcula el estado de ejecución (compra / facturación / pago) tras registrar compras, facturas o pagos. */
export async function syncExecutionStatus(reqId, userId) {
  const r = await getRequisition(reqId);
  if (!EXECUTION.includes(r.status)) return r.status;

  const purchases = await db.column('SELECT id FROM purchases WHERE requisition_id = ?', [reqId]);
  let target;
  if (!purchases.length) {
    target = 'en_compra';
  } else {
    const items = await itemsOf(reqId);
    const complete = r.purchase_completed ||
      items.every((it) => effectiveQty(it) <= EPS || it.purchased_quantity >= effectiveQty(it) - EPS);
    if (!complete) {
      target = 'compra_parcial';
    } else {
      const invoices = await invoiceBalances('i.requisition_id = @id', { id: reqId });
      const uninvoiced = await db.value(`SELECT COUNT(*) FROM purchases p WHERE p.requisition_id = ?
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.purchase_id = p.id)`, [reqId]);
      if (!invoices.length) target = 'compra_ejecutada';
      else if (uninvoiced > 0) target = 'facturada';
      else target = invoices.every((i) => i.balance <= EPS) ? 'pagada' : 'pendiente_pago';
    }
  }
  if (target !== r.status) await transition(r, target, userId, 'cambio_estado');
  return target;
}

// ---------------------------------------------------------------------------
// Serialización según permisos (los datos financieros nunca salen sin `req.ver_finanzas`)
// ---------------------------------------------------------------------------

export async function serializeItem(it, finance) {
  const base = {
    id: it.id,
    position: it.position,
    article_id: it.article_id,
    category_id: it.category_id,
    category_name: it.category_name,
    item_name: it.item_name,
    unit_id: it.unit_id,
    unit_name: it.unit_name,
    quantity: it.quantity,
    approved_quantity: it.approved_quantity,
    specifications: it.specifications,
    is_unregistered: !!it.is_unregistered,
    description: it.description,
    reference_file_id: it.reference_file_id,
    reference_file: it.reference_file_id ? await fileRef(it.reference_file_id) : null,
    catalog_review: it.catalog_review,
    purchasing_comment: it.purchasing_comment,
    purchased_quantity: it.purchased_quantity ?? 0,
  };
  if (!finance) return base;
  const qty = effectiveQty(it);
  return {
    ...base,
    supplier_id: it.supplier_id,
    supplier_name: it.supplier_name,
    estimated_unit_price: it.estimated_unit_price,
    estimated_line_total: it.estimated_unit_price != null ? round2(qty * it.estimated_unit_price) : null,
  };
}

async function fileRef(id) {
  const f = await db.get('SELECT uuid, original_name, mime, size, kind FROM files WHERE id = ?', [id]);
  return f ? { ...f, url: `/api/archivos/${f.uuid}` } : null;
}

export async function serializeRequisition(r, user) {
  const finance = can(user, 'req.ver_finanzas');
  const names = await db.all('SELECT id, first_name, last_name FROM users WHERE id IN (?,?,?,?,?,?)',
    [r.requester_id, r.received_by, r.reviewed_by, r.decided_by, r.closed_by, -1]);
  const nameOf = (id) => { const u = names.find((n) => n.id === id); return u ? fullName(u.first_name, u.last_name) : null; };
  const dept = await db.get('SELECT name, code FROM departments WHERE id = ?', [r.department_id]);
  const items = await itemsOf(r.id);

  const events = (await db.all(`
    SELECT e.id, e.action, e.from_status, e.to_status, e.comment, e.created_at, e.finance_only,
      u.first_name, u.last_name, u.role
    FROM requisition_events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.requisition_id = ? ${finance ? '' : 'AND e.finance_only = 0'} ORDER BY e.created_at, e.id`, [r.id]))
    .map((e) => ({ ...e, finance_only: !!e.finance_only, user_name: fullName(e.first_name, e.last_name), first_name: undefined, last_name: undefined }));

  const out = {
    id: r.id,
    number: r.number,
    status: r.status,
    status_label: ESTADOS[r.status]?.label || r.status,
    priority: r.priority,
    created_at: r.created_at,
    updated_at: r.updated_at,
    submitted_at: r.submitted_at,
    required_date: r.required_date,
    justification: r.justification,
    requester_id: r.requester_id,
    requester_name: nameOf(r.requester_id),
    department_id: r.department_id,
    department_name: dept?.name,
    department_code: dept?.code,
    received_by_name: nameOf(r.received_by),
    received_at: r.received_at,
    reviewed_by_name: nameOf(r.reviewed_by),
    reviewed_at: r.reviewed_at,
    decided_by_name: nameOf(r.decided_by),
    decided_at: r.decided_at,
    decision_notes: r.decision_notes,
    closed_by_name: nameOf(r.closed_by),
    closed_at: r.closed_at,
    purchase_completed: !!r.purchase_completed,
    items: await Promise.all(items.map((it) => serializeItem(it, finance))),
    events,
    attachments: (await db.all(`SELECT uuid, original_name, mime, size, kind, created_at FROM files
      WHERE requisition_id = ? ${finance ? '' : "AND kind = 'referencia'"} ORDER BY id`, [r.id]))
      .map((f) => ({ ...f, url: `/api/archivos/${f.uuid}` })),
  };

  if (finance) {
    out.currency = r.currency;
    out.purchasing_notes = r.purchasing_notes;
    out.estimated_total = estimatedTotal(items);
    out.approved_total = r.approved_total;
    out.reviewed_by = r.reviewed_by;
    out.quotations = (await db.all(`
      SELECT q.id, q.supplier_id, s.name AS supplier_name, q.amount, q.currency, q.notes, q.created_at,
        f.uuid AS file_uuid, f.original_name AS file_name, u.first_name || ' ' || u.last_name AS created_by_name
      FROM quotations q JOIN suppliers s ON s.id = q.supplier_id LEFT JOIN files f ON f.id = q.file_id
      JOIN users u ON u.id = q.created_by WHERE q.requisition_id = ? ORDER BY q.id`, [r.id]))
      .map((q) => ({ ...q, file_url: q.file_uuid ? `/api/archivos/${q.file_uuid}` : null }));
    const purchases = await db.all(`
      SELECT p.*, s.name AS supplier_name, u.first_name || ' ' || u.last_name AS created_by_name
      FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.created_by
      WHERE p.requisition_id = ? ORDER BY p.purchase_date, p.id`, [r.id]);
    out.purchases = [];
    for (const p of purchases) {
      const lines = (await db.all(`SELECT pi.*, ri.item_name, ri.unit_name FROM purchase_items pi
        JOIN requisition_items ri ON ri.id = pi.requisition_item_id WHERE pi.purchase_id = ? ORDER BY pi.id`, [p.id]))
        .map((l) => ({ ...l, line_total: round2(l.quantity * l.unit_price) }));
      out.purchases.push({ ...p, items: lines, total: round2(lines.reduce((a, l) => a + l.line_total, 0)) });
    }
    out.purchases_total = r.currency ? await purchasesTotal(r.id, r.currency) : 0;
    out.invoices = [];
    for (const i of await invoiceBalances('i.requisition_id = @id', { id: r.id })) {
      const f = await db.get('SELECT uuid, original_name FROM files WHERE id = ?', [i.file_id]);
      out.invoices.push({ ...i, file_url: f ? `/api/archivos/${f.uuid}` : null, file_name: f?.original_name });
    }
    out.tolerance_pct = Number(await getSetting('tolerancia_sobrecosto_pct')) || 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Líneas de la requisición (creación / corrección por el solicitante)
// ---------------------------------------------------------------------------

export async function saveItems(reqId, items, user) {
  const existing = new Map((await db.all('SELECT * FROM requisition_items WHERE requisition_id = ?', [reqId])).map((i) => [i.id, i]));
  const keep = new Set();

  for (const [idx, input] of items.entries()) {
    const n = idx + 1;
    const u = await db.get('SELECT * FROM units WHERE id = ?', [input.unit_id]);
    if (!u) throw badRequest(`Línea ${n}: seleccione una unidad de medida válida.`);
    let row;
    if (input.is_unregistered) {
      const c = input.category_id ? await db.get('SELECT * FROM categories WHERE id = ?', [input.category_id]) : null;
      if (input.category_id && !c) throw badRequest(`Línea ${n}: la categoría sugerida no existe.`);
      let fileId = null;
      if (input.reference_file_id) {
        const f = await db.get(`SELECT * FROM files WHERE id = ? AND kind = 'referencia'`, [input.reference_file_id]);
        if (!f || (f.requisition_id && f.requisition_id !== reqId) || (!f.requisition_id && f.uploaded_by !== user.id)) {
          throw badRequest(`Línea ${n}: el archivo de referencia no es válido.`);
        }
        await db.run('UPDATE files SET requisition_id = ? WHERE id = ?', [reqId, f.id]);
        fileId = f.id;
      }
      row = {
        article_id: null, category_id: c?.id ?? null, category_name: c?.name ?? '', item_name: input.item_name,
        is_unregistered: 1, description: input.description || '', reference_file_id: fileId,
      };
    } else {
      const a = await db.get(`SELECT a.*, c.name AS category_name FROM articles a JOIN categories c ON c.id = a.category_id WHERE a.id = ?`, [input.article_id]);
      if (!a) throw badRequest(`Línea ${n}: el artículo seleccionado no existe.`);
      const prev = input.id ? existing.get(input.id) : null;
      // Un artículo desactivado puede conservarse en una línea existente, pero no agregarse de nuevo.
      if (!a.active && prev?.article_id !== a.id) throw badRequest(`Línea ${n}: el artículo "${a.name}" está desactivado.`);
      row = {
        article_id: a.id, category_id: a.category_id, category_name: a.category_name, item_name: a.name,
        is_unregistered: 0, description: '', reference_file_id: null,
      };
    }
    Object.assign(row, {
      position: n, unit_id: u.id, unit_name: u.name, quantity: input.quantity, specifications: input.specifications || '',
    });

    const prev = input.id ? existing.get(input.id) : null;
    if (prev) {
      keep.add(prev.id);
      // Si cambió el artículo o la cantidad, se invalida la validación previa de Compras.
      const changed = prev.article_id !== row.article_id || prev.item_name !== row.item_name || prev.quantity !== row.quantity || prev.unit_id !== row.unit_id;
      await db.run(`UPDATE requisition_items SET position=@position, article_id=@article_id, category_id=@category_id,
        category_name=@category_name, item_name=@item_name, unit_id=@unit_id, unit_name=@unit_name, quantity=@quantity,
        specifications=@specifications, is_unregistered=@is_unregistered, description=@description,
        reference_file_id=@reference_file_id, catalog_review=@catalog_review
        ${changed ? ', approved_quantity = NULL' : ''} WHERE id=@id`,
      { ...row, catalog_review: row.is_unregistered ? (prev.catalog_review || 'pendiente') : null, id: prev.id });
    } else {
      await db.run(`INSERT INTO requisition_items (requisition_id, position, article_id, category_id, category_name, item_name,
        unit_id, unit_name, quantity, specifications, is_unregistered, description, reference_file_id, catalog_review)
        VALUES (@requisition_id, @position, @article_id, @category_id, @category_name, @item_name, @unit_id, @unit_name,
        @quantity, @specifications, @is_unregistered, @description, @reference_file_id, @catalog_review)`,
      { ...row, requisition_id: reqId, catalog_review: row.is_unregistered ? 'pendiente' : null });
    }
  }

  for (const id of existing.keys()) {
    if (!keep.has(id)) await db.run('DELETE FROM requisition_items WHERE id = ?', [id]);
  }
}

export async function assertSubmittable(r) {
  const items = await db.value('SELECT COUNT(*) FROM requisition_items WHERE requisition_id = ?', [r.id]);
  if (!items) throw badRequest('Agregue al menos un artículo antes de enviar la requisición.');
  if (!r.required_date) throw badRequest('Indique la fecha requerida.');
  if (r.status === 'borrador' && r.required_date < new Date().toISOString().slice(0, 10)) {
    throw badRequest('La fecha requerida no puede ser anterior a hoy.');
  }
  if (!r.justification || r.justification.trim().length < 10) {
    throw badRequest('Describa el motivo o justificación (mínimo 10 caracteres).');
  }
}

export function assertNotSelf(user, r, field, msg) {
  if (r[field] === user.id) throw forbidden(msg);
}
