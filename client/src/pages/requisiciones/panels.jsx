import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import {
  Button, Card, ConfirmDialog, ErrorBox, Field, FileInput, FileLink, Modal, PaymentBadge, StatusBadge,
  fmtDate, fmtDateTime, fmtMoney, fmtQty, todayISO, useAction, useFetch,
} from '../../components/ui.jsx';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === '' || v == null ? null : Number(v));

// ---------------------------------------------------------------------------
// Revisión de Compras: cantidades, proveedores, precios y envío a Administración
// ---------------------------------------------------------------------------

export function ReviewPanel({ r, onSaved }) {
  const { config } = useAuth();
  const suppliers = useFetch('/api/proveedores');
  const [currency, setCurrency] = useState(r.currency || config?.moneda_principal || 'USD');
  const [notes, setNotes] = useState(r.purchasing_notes || '');
  const [items, setItems] = useState(() => r.items.map((it) => ({
    id: it.id,
    approved_quantity: it.approved_quantity ?? it.quantity,
    purchasing_comment: it.purchasing_comment || '',
    supplier_id: it.supplier_id || '',
    estimated_unit_price: it.estimated_unit_price ?? '',
  })));
  const [confirm, setConfirm] = useState(false);
  const [run, busy] = useAction();

  const upd = (id, patch) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const total = round2(items.reduce((a, x) => a + (Number(x.approved_quantity) || 0) * (Number(x.estimated_unit_price) || 0), 0));
  const missing = items.filter((x) => Number(x.approved_quantity) > 0 && x.estimated_unit_price === '').length;

  const body = () => ({
    currency, purchasing_notes: notes,
    items: items.map((x) => ({ ...x, approved_quantity: num(x.approved_quantity), estimated_unit_price: num(x.estimated_unit_price), supplier_id: x.supplier_id || null })),
  });

  return (
    <Card title="Revisión y cotización (Compras)" icon="search" className="card-accent">
      <p className="muted small">Valide cantidades y especificaciones, asigne proveedores y registre precios unitarios estimados. Los totales se calculan automáticamente.</p>
      <div className="table-wrap">
        <table className="table table-responsive table-edit">
          <thead>
            <tr><th>Artículo</th><th className="num">Solicitado</th><th>Cant. validada</th><th>Proveedor</th><th>Precio unit.</th><th className="num">Total</th><th>Comentario</th></tr>
          </thead>
          <tbody>
            {r.items.map((it) => {
              const x = items.find((i) => i.id === it.id);
              const line = round2((Number(x.approved_quantity) || 0) * (Number(x.estimated_unit_price) || 0));
              return (
                <tr key={it.id}>
                  <td data-label="Artículo">
                    <strong>{it.item_name}</strong>
                    {it.is_unregistered && <span className="badge ml tone-orange">No registrado</span>}
                    {it.specifications && <div className="muted small">{it.specifications}</div>}
                    {it.description && <div className="muted small">{it.description}</div>}
                    {it.reference_file && <FileLink url={it.reference_file.url} name={it.reference_file.original_name} />}
                  </td>
                  <td data-label="Solicitado" className="num">{fmtQty(it.quantity)} {it.unit_name}</td>
                  <td data-label="Cant. validada"><input type="number" min="0" step="any" className="input-sm" value={x.approved_quantity} onChange={(e) => upd(it.id, { approved_quantity: e.target.value })} /></td>
                  <td data-label="Proveedor">
                    <select className="input-sm" value={x.supplier_id} onChange={(e) => upd(it.id, { supplier_id: e.target.value })}>
                      <option value="">—</option>
                      {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td data-label="Precio unit."><input type="number" min="0" step="0.01" className={`input-sm ${x.estimated_unit_price === '' && Number(x.approved_quantity) > 0 ? 'invalid' : ''}`} value={x.estimated_unit_price} onChange={(e) => upd(it.id, { estimated_unit_price: e.target.value })} /></td>
                  <td data-label="Total" className="num">{fmtMoney(line)}</td>
                  <td data-label="Comentario"><input className="input-sm" maxLength={1000} placeholder="Opcional" value={x.purchasing_comment} onChange={(e) => upd(it.id, { purchasing_comment: e.target.value })} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td colSpan={99} className="num strong">Total estimado: {fmtMoney(total, currency)}</td></tr></tfoot>
        </table>
      </div>
      <div className="form-grid">
        <Field label="Moneda">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {(config?.monedas || ['USD']).map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Observaciones de Compras para Administración" className="span-2">
          <textarea rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="row gap wrap end">
        <Button variant="secondary" icon="check" busy={busy} onClick={() => run(async () => onSaved(await api.put(`/api/requisiciones/${r.id}/revision`, body())), 'Revisión guardada.')}>Guardar revisión</Button>
        <Button icon="send" disabled={busy || missing > 0} title={missing ? 'Faltan precios por registrar' : undefined} onClick={() => setConfirm(true)}>
          Marcar como revisada y enviar a Administración
        </Button>
      </div>
      {missing > 0 && <p className="muted small end-text">Registre el precio de {missing} artículo(s) para poder enviar.</p>}
      {confirm && (
        <ConfirmDialog
          title="Enviar a Administración"
          message={`Total estimado: ${fmtMoney(total, currency)}. Se registrará su nombre como responsable de la revisión y se notificará a Administración.`}
          confirmText="Marcar como revisada y enviar"
          commentLabel="Comentario (opcional)"
          onClose={() => setConfirm(false)}
          onConfirm={async (comment) => onSaved(await api.post(`/api/requisiciones/${r.id}/enviar-administracion`, { ...body(), comment }))}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Validación de artículos no registrados para el catálogo oficial
// ---------------------------------------------------------------------------

export function CatalogPanel({ r, onSaved }) {
  const cat = useFetch('/api/catalogo');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const pending = r.items.filter((it) => it.catalog_review === 'pendiente');
  const send = (it, body, msg) => run(async () => onSaved(await api.post(`/api/requisiciones/${r.id}/items/${it.id}/catalogo`, body)), msg);
  return (
    <Card title="Artículos no registrados" icon="tag">
      <p className="muted small">Decida si estos artículos deben incorporarse al catálogo oficial compartido.</p>
      <ul className="plain-list">
        {pending.map((it) => (
          <li key={it.id} className="row between wrap gap">
            <div><strong>{it.item_name}</strong><div className="muted small">{it.category_name || 'Sin categoría sugerida'} · {it.unit_name}{it.description ? ` · ${it.description}` : ''}</div></div>
            <div className="row gap">
              <Button size="sm" icon="plus" onClick={() => setEdit({ it, name: it.item_name, category_id: it.category_id || '', unit_id: it.unit_id || '', code: '' })}>Incorporar</Button>
              <Button size="sm" variant="ghost" busy={busy} onClick={() => send(it, { accion: 'descartar' }, 'Artículo descartado para el catálogo.')}>Descartar</Button>
            </div>
          </li>
        ))}
      </ul>
      {edit && (
        <Modal title="Incorporar al catálogo" onClose={() => setEdit(null)} footer={(
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button busy={busy} disabled={!edit.category_id || edit.name.trim().length < 2} onClick={() => send(edit.it, {
              accion: 'incorporar', name: edit.name, category_id: edit.category_id, unit_id: edit.unit_id || null, code: edit.code,
            }, 'Artículo incorporado al catálogo.').then(() => setEdit(null)).catch(() => {})}>Incorporar</Button>
          </>
        )}>
          <div className="form-grid">
            <Field label="Nombre oficial" required className="span-2"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Categoría" required>
              <select value={edit.category_id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                <option value="">Seleccione</option>
                {cat.data?.categorias.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Unidad por defecto">
              <select value={edit.unit_id} onChange={(e) => setEdit({ ...edit, unit_id: e.target.value })}>
                <option value="">—</option>
                {cat.data?.unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Código (opcional)"><input value={edit.code} maxLength={40} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cotizaciones
// ---------------------------------------------------------------------------

export function QuotationsPanel({ r, canEdit, onSaved }) {
  const { config } = useAuth();
  const suppliers = useFetch(canEdit ? '/api/proveedores' : null);
  const empty = { supplier_id: '', amount: '', currency: r.currency || config?.moneda_principal || 'USD', notes: '' };
  const [f, setF] = useState(empty);
  const [file, setFile] = useState(null);
  const [open, setOpen] = useState(false);
  const [run, busy] = useAction();

  async function add() {
    await run(async () => {
      onSaved(await api.upload(`/api/requisiciones/${r.id}/cotizaciones`, f, file));
      setF(empty); setFile(null); setOpen(false);
    }, 'Cotización adjuntada.');
  }

  return (
    <Card title="Cotizaciones" icon="file" actions={canEdit && <Button size="sm" icon="upload" onClick={() => setOpen(true)}>Adjuntar cotización</Button>}>
      {r.quotations.length === 0 ? <p className="muted">Aún no se han adjuntado cotizaciones.</p> : (
        <div className="table-wrap">
          <table className="table table-responsive">
            <thead><tr><th>Proveedor</th><th className="num">Monto</th><th>Notas</th><th>Documento</th><th>Cargada</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {r.quotations.map((q) => (
                <tr key={q.id}>
                  <td data-label="Proveedor">{q.supplier_name}</td>
                  <td data-label="Monto" className="num">{fmtMoney(q.amount, q.currency)}</td>
                  <td data-label="Notas">{q.notes || '—'}</td>
                  <td data-label="Documento">{q.file_url ? <FileLink url={q.file_url} name={q.file_name} /> : '—'}</td>
                  <td data-label="Cargada" className="small">{q.created_by_name}<br />{fmtDateTime(q.created_at)}</td>
                  {canEdit && (
                    <td><button type="button" className="icon-btn danger" aria-label="Eliminar cotización" disabled={busy}
                      onClick={() => run(async () => onSaved(await api.del(`/api/requisiciones/${r.id}/cotizaciones/${q.id}`)), 'Cotización eliminada.')}>
                      <Icon name="trash" size={16} /></button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <Modal title="Adjuntar cotización" onClose={() => setOpen(false)} footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button icon="upload" busy={busy} disabled={!f.supplier_id || (!file && !f.amount)} onClick={add}>Adjuntar</Button>
          </>
        )}>
          <div className="form-grid">
            <Field label="Proveedor" required className="span-2">
              <select value={f.supplier_id} onChange={(e) => setF({ ...f, supplier_id: e.target.value })}>
                <option value="">Seleccione</option>
                {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Monto total cotizado"><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Moneda">
              <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{(config?.monedas || []).map((m) => <option key={m}>{m}</option>)}</select>
            </Field>
            <Field label="Notas" className="span-2"><input maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Validez, condiciones de pago, tiempo de entrega…" /></Field>
            <Field label="Documento de la cotización" className="span-2"><FileInput file={file} onChange={setFile} /></Field>
          </div>
          <p className="muted small">¿El proveedor no aparece? Regístrelo en el menú Proveedores.</p>
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Decisión de Administración
// ---------------------------------------------------------------------------

export function DecisionPanel({ r, onSaved }) {
  const [mode, setMode] = useState(null);
  const [destino, setDestino] = useState('compras');
  const post = (url, body) => async () => onSaved(await api.post(`/api/requisiciones/${r.id}/${url}`, body));
  return (
    <Card title="Decisión de Administración" icon="shield" className="card-accent">
      <div className="decision">
        <div>
          <span className="muted">Total estimado presentado por Compras</span>
          <strong className="big">{fmtMoney(r.estimated_total, r.currency)}</strong>
          <span className="muted small">Revisado por {r.reviewed_by_name} el {fmtDateTime(r.reviewed_at)}</span>
        </div>
        <div className="row gap wrap">
          <Button icon="check" onClick={() => setMode('aprobar')}>Aprobar requisición</Button>
          <Button variant="warn" icon="undo" onClick={() => setMode('devolver')}>Devolver para corrección</Button>
          <Button variant="danger" icon="x" onClick={() => setMode('rechazar')}>Rechazar</Button>
        </div>
      </div>
      {mode === 'aprobar' && (
        <ConfirmDialog title={`Aprobar ${r.number}`} confirmText="Aprobar" commentLabel="Observaciones (opcional)"
          message={`Autoriza a Compras a adquirir según los términos revisados por ${fmtMoney(r.estimated_total, r.currency)}.`}
          onClose={() => setMode(null)} onConfirm={(comment) => post('aprobar', { comment })()} />
      )}
      {mode === 'rechazar' && (
        <ConfirmDialog title={`Rechazar ${r.number}`} confirmText="Rechazar" variant="danger" commentLabel="Motivo del rechazo" commentRequired minLength={5}
          onClose={() => setMode(null)} onConfirm={(comment) => post('rechazar', { comment })()} />
      )}
      {mode === 'devolver' && (
        <ConfirmDialog title={`Devolver ${r.number}`} confirmText="Devolver" variant="warn" commentLabel="Observaciones" commentRequired minLength={5}
          onClose={() => setMode(null)} onConfirm={(comment) => post('devolver', { destino, comment })()}>
          <Field label="Devolver a" group>
            <div className="segmented">
              <button type="button" className={`seg ${destino === 'compras' ? 'on' : ''}`} onClick={() => setDestino('compras')}>Compras</button>
              <button type="button" className={`seg ${destino === 'solicitante' ? 'on' : ''}`} onClick={() => setDestino('solicitante')}>Departamento solicitante</button>
            </div>
          </Field>
        </ConfirmDialog>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Registro de compras
// ---------------------------------------------------------------------------

export function PurchasesPanel({ r, actions, onSaved }) {
  const [open, setOpen] = useState(false);
  const [finish, setFinish] = useState(false);
  const canBuy = actions.includes('registrar_compra');
  const limit = round2((r.approved_total || 0) * (1 + (r.tolerance_pct || 0) / 100));
  return (
    <Card title="Compras registradas" icon="cart" actions={(
      <div className="row gap">
        {actions.includes('finalizar_compra') && <Button size="sm" variant="ghost" icon="check" onClick={() => setFinish(true)}>Finalizar compra</Button>}
        {canBuy && <Button size="sm" icon="plus" onClick={() => setOpen(true)}>Registrar compra</Button>}
      </div>
    )}>
      {r.approved_total != null && (
        <div className="progress-money">
          <span>Comprado: <strong>{fmtMoney(r.purchases_total, r.currency)}</strong> de {fmtMoney(r.approved_total, r.currency)} aprobados</span>
          <div className="bar"><span style={{ width: `${Math.min(100, (r.purchases_total / (r.approved_total || 1)) * 100)}%` }} /></div>
          <small className="muted">Límite con tolerancia de {r.tolerance_pct}%: {fmtMoney(limit, r.currency)}</small>
        </div>
      )}
      {r.purchases.length === 0 ? <p className="muted">Aún no se han registrado compras.</p> : r.purchases.map((p) => (
        <div key={p.id} className="subcard">
          <div className="row between wrap">
            <strong>{p.supplier_name}</strong>
            <span className="muted small">Compra del {fmtDate(p.purchase_date)} · registrada por {p.created_by_name}</span>
          </div>
          <table className="table table-compact">
            <thead><tr><th>Artículo</th><th className="num">Cantidad</th><th className="num">Precio unit.</th><th className="num">Total</th></tr></thead>
            <tbody>
              {p.items.map((l) => <tr key={l.id}><td>{l.item_name}</td><td className="num">{fmtQty(l.quantity)} {l.unit_name}</td><td className="num">{fmtMoney(l.unit_price)}</td><td className="num">{fmtMoney(l.line_total)}</td></tr>)}
            </tbody>
            <tfoot><tr><td colSpan={4} className="num strong">Total: {fmtMoney(p.total, p.currency)}</td></tr></tfoot>
          </table>
          {p.notes && <p className="muted small">{p.notes}</p>}
        </div>
      ))}
      {open && <PurchaseModal r={r} onClose={() => setOpen(false)} onSaved={(d) => { onSaved(d); setOpen(false); }} />}
      {finish && (
        <ConfirmDialog title="Finalizar compra parcial" confirmText="Finalizar compra" commentRequired commentLabel="Motivo (p. ej. artículos no disponibles)"
          message="Se dará por concluida la compra con las cantidades adquiridas hasta ahora. No podrán registrarse nuevas compras."
          onClose={() => setFinish(false)} onConfirm={async (comment) => onSaved(await api.post(`/api/requisiciones/${r.id}/finalizar-compra`, { comment }))} />
      )}
    </Card>
  );
}

function PurchaseModal({ r, onClose, onSaved }) {
  const suppliers = useFetch('/api/proveedores');
  const pendingItems = r.items.filter((it) => (it.approved_quantity ?? it.quantity) - it.purchased_quantity > 0.0001);
  const [f, setF] = useState({ supplier_id: '', purchase_date: todayISO(), notes: '' });
  const [lines, setLines] = useState(() => Object.fromEntries(pendingItems.map((it) => [it.id, {
    on: false, quantity: round2((it.approved_quantity ?? it.quantity) - it.purchased_quantity), unit_price: it.estimated_unit_price ?? '',
  }])));
  const [run, busy] = useAction();
  const [error, setError] = useState(null);

  // Al elegir proveedor, preselecciona los artículos que Compras le asignó.
  function chooseSupplier(id) {
    setF({ ...f, supplier_id: id });
    setLines((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => {
      const it = pendingItems.find((x) => x.id === Number(k));
      return [k, { ...v, on: id ? it.supplier_id === Number(id) || v.on : v.on }];
    })));
  }

  const selected = Object.entries(lines).filter(([, v]) => v.on);
  const total = round2(selected.reduce((a, [, v]) => a + (Number(v.quantity) || 0) * (Number(v.unit_price) || 0), 0));

  async function save() {
    setError(null);
    try {
      await run(async () => onSaved(await api.post(`/api/requisiciones/${r.id}/compras`, {
        ...f, currency: r.currency,
        items: selected.map(([k, v]) => ({ requisition_item_id: Number(k), quantity: Number(v.quantity), unit_price: Number(v.unit_price) })),
      })), 'Compra registrada.');
    } catch (e) { setError(e); }
  }

  return (
    <Modal title="Registrar compra" size="lg" onClose={onClose} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button icon="check" busy={busy} disabled={!f.supplier_id || !selected.length} onClick={save}>Registrar compra por {fmtMoney(total, r.currency)}</Button>
      </>
    )}>
      <div className="form-grid">
        <Field label="Proveedor" required className="span-2">
          <select value={f.supplier_id} onChange={(e) => chooseSupplier(e.target.value)}>
            <option value="">Seleccione</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Fecha de compra" required><input type="date" max={todayISO()} value={f.purchase_date} onChange={(e) => setF({ ...f, purchase_date: e.target.value })} /></Field>
        <Field label="Moneda"><input value={r.currency} disabled /></Field>
      </div>
      <p className="muted small">Marque los artículos adquiridos. Puede registrar compras parciales; las cantidades no pueden superar lo aprobado.</p>
      <div className="table-wrap">
        <table className="table table-edit table-responsive">
          <thead><tr><th /><th>Artículo</th><th className="num">Pendiente</th><th>Cantidad adquirida</th><th>Precio unit. definitivo</th><th className="num">Total</th></tr></thead>
          <tbody>
            {pendingItems.map((it) => {
              const v = lines[it.id];
              const set = (patch) => setLines({ ...lines, [it.id]: { ...v, ...patch } });
              const remaining = round2((it.approved_quantity ?? it.quantity) - it.purchased_quantity);
              return (
                <tr key={it.id} className={v.on ? '' : 'row-off'}>
                  <td><input type="checkbox" checked={v.on} onChange={(e) => set({ on: e.target.checked })} aria-label={`Incluir ${it.item_name}`} /></td>
                  <td data-label="Artículo">{it.item_name}<div className="muted small">Est.: {fmtMoney(it.estimated_unit_price)} · {it.supplier_name || 'sin proveedor sugerido'}</div></td>
                  <td data-label="Pendiente" className="num">{fmtQty(remaining)} {it.unit_name}</td>
                  <td data-label="Cantidad"><input type="number" className="input-sm" min="0" max={remaining} step="any" disabled={!v.on} value={v.quantity} onChange={(e) => set({ quantity: e.target.value })} /></td>
                  <td data-label="Precio unit."><input type="number" className="input-sm" min="0" step="0.01" disabled={!v.on} value={v.unit_price} onChange={(e) => set({ unit_price: e.target.value })} /></td>
                  <td data-label="Total" className="num">{v.on ? fmtMoney((Number(v.quantity) || 0) * (Number(v.unit_price) || 0)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Field label="Notas"><input maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="N.º de orden de compra, condiciones, entrega…" /></Field>
      <ErrorBox error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Facturas
// ---------------------------------------------------------------------------

export function InvoicesPanel({ r, canUpload, onSaved }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title="Facturas" icon="receipt" actions={canUpload && <Button size="sm" icon="upload" onClick={() => setOpen(true)}>Cargar factura</Button>}>
      {r.invoices.length === 0 ? <p className="muted">Aún no se han cargado facturas.</p> : (
        <div className="table-wrap">
          <table className="table table-responsive">
            <thead><tr><th>Factura</th><th>Proveedor</th><th>Fecha</th><th>Vence</th><th className="num">Monto</th><th className="num">Pagado</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
            <tbody>
              {r.invoices.map((i) => (
                <tr key={i.id}>
                  <td data-label="Factura"><FileLink url={i.file_url}>N.º {i.number}</FileLink></td>
                  <td data-label="Proveedor">{i.supplier_name}</td>
                  <td data-label="Fecha">{fmtDate(i.invoice_date)}</td>
                  <td data-label="Vence">{fmtDate(i.due_date)}</td>
                  <td data-label="Monto" className="num">{fmtMoney(i.amount, i.currency)}</td>
                  <td data-label="Pagado" className="num">{fmtMoney(i.paid)}</td>
                  <td data-label="Saldo" className="num">{fmtMoney(i.balance)}</td>
                  <td data-label="Estado"><PaymentBadge status={i.payment_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <InvoiceModal r={r} onClose={() => setOpen(false)} onSaved={(d) => { onSaved(d); setOpen(false); }} />}
    </Card>
  );
}

function InvoiceModal({ r, onClose, onSaved }) {
  const { config } = useAuth();
  const invoicedByPurchase = useMemo(() => {
    const m = {};
    for (const i of r.invoices) m[i.purchase_id] = (m[i.purchase_id] || 0) + 1;
    return m;
  }, [r.invoices]);
  const first = r.purchases.find((p) => !invoicedByPurchase[p.id]) || r.purchases[0];
  const [f, setF] = useState({
    purchase_id: first?.id || '', number: '', invoice_date: todayISO(), due_date: '', amount: first?.total ?? '', currency: first?.currency || r.currency, notes: '',
  });
  const [file, setFile] = useState(null);
  const [run, busy] = useAction();
  const [error, setError] = useState(null);
  const purchase = r.purchases.find((p) => p.id === Number(f.purchase_id));

  async function save() {
    setError(null);
    try { await run(async () => onSaved(await api.upload(`/api/requisiciones/${r.id}/facturas`, f, file)), 'Factura cargada. Administración fue notificada.'); } catch (e) { setError(e); }
  }

  return (
    <Modal title="Cargar factura" onClose={onClose} footer={(
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button icon="upload" busy={busy} disabled={!f.purchase_id || !f.number.trim() || !(Number(f.amount) > 0) || !file} onClick={save}>Cargar factura</Button>
      </>
    )}>
      <div className="form-grid">
        <Field label="Compra asociada" required className="span-2">
          <select value={f.purchase_id} onChange={(e) => {
            const p = r.purchases.find((x) => x.id === Number(e.target.value));
            setF({ ...f, purchase_id: e.target.value, amount: p?.total ?? f.amount, currency: p?.currency || f.currency });
          }}>
            {r.purchases.map((p) => (
              <option key={p.id} value={p.id}>{p.supplier_name} · {fmtDate(p.purchase_date)} · {fmtMoney(p.total, p.currency)}{invoicedByPurchase[p.id] ? ` (${invoicedByPurchase[p.id]} factura/s)` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Proveedor"><input value={purchase?.supplier_name || ''} disabled /></Field>
        <Field label="Número de factura" required><input maxLength={60} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></Field>
        <Field label="Fecha de factura" required><input type="date" max={todayISO()} value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></Field>
        <Field label="Fecha de vencimiento" hint="Si se deja vacía se calcula según los días de crédito configurados."><input type="date" min={f.invoice_date} value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Monto total facturado" required><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Moneda">
          <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>{(config?.monedas || []).map((m) => <option key={m}>{m}</option>)}</select>
        </Field>
        <Field label="Archivo de la factura" required className="span-2"><FileInput file={file} onChange={setFile} required /></Field>
        <Field label="Notas" className="span-2"><input maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {purchase && Number(f.amount) > 0 && f.currency === purchase.currency && Math.abs(Number(f.amount) - purchase.total) > 0.009 && (
        <div className="alert alert-warn">El monto difiere del total de la compra ({fmtMoney(purchase.total, purchase.currency)}). Verifique impuestos o cargos adicionales.</div>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Línea de tiempo y observaciones
// ---------------------------------------------------------------------------

const ACCIONES = {
  creacion: 'Requisición creada', envio: 'Enviada a Compras', reenvio: 'Reenviada a Compras tras corrección',
  correccion: 'Corregida por el departamento', recepcion: 'Recibida por Compras', devolucion_solicitante: 'Devuelta al departamento para corrección',
  revisada: 'Revisada por Compras', envio_administracion: 'Revisada y enviada a Administración', devolucion_compras: 'Devuelta a Compras por Administración',
  aprobacion: 'Aprobada', monto_aprobado: 'Monto aprobado', rechazo: 'Rechazada', inicio_compra: 'Inicio del proceso de compra',
  compra_registrada: 'Compra registrada', compra_finalizada: 'Compra finalizada', factura_registrada: 'Factura registrada',
  pago_programado: 'Pago programado', pago_programado_anulado: 'Programación de pago anulada', pago_realizado: 'Pago realizado',
  cambio_estado: 'Cambio de estado', cierre: 'Requisición cerrada', anulacion: 'Requisición anulada', comentario: 'Observación',
  cotizacion: 'Cotización adjuntada', cotizacion_eliminada: 'Cotización eliminada', catalogo: 'Validación de catálogo',
};
const TONE = {
  aprobacion: 'green', rechazo: 'red', devolucion_solicitante: 'orange', devolucion_compras: 'orange', cierre: 'dark', anulacion: 'gray',
  pago_realizado: 'green', comentario: 'blue',
};

export function Timeline({ r, onSaved }) {
  const { can } = useAuth();
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [run, busy] = useAction();
  const events = [...r.events].reverse();
  return (
    <Card title="Historial de actuaciones" icon="clock">
      {r.actions.includes('comentar') && (
        <div className="comment-box">
          <textarea rows={2} maxLength={4000} placeholder="Agregar una observación o aclaratoria…" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="row between wrap gap">
            {can('req.ver_finanzas') ? <label className="check small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Nota interna (no visible al solicitante)</label> : <span />}
            <Button size="sm" icon="message" busy={busy} disabled={comment.trim().length < 3}
              onClick={() => run(async () => { onSaved(await api.post(`/api/requisiciones/${r.id}/comentarios`, { comment, interno: internal })); setComment(''); }, 'Observación registrada.')}>
              Comentar
            </Button>
          </div>
        </div>
      )}
      <ol className="timeline">
        {events.map((e) => (
          <li key={e.id} className={`tl-${TONE[e.action] || (e.finance_only ? 'purple' : 'default')}`}>
            <div className="tl-head">
              <strong>{ACCIONES[e.action] || e.action}</strong>
              {e.to_status && e.action === 'cambio_estado' && <StatusBadge status={e.to_status} />}
              {e.finance_only && <span className="badge tone-purple">Interno</span>}
            </div>
            {e.comment && <p>{e.comment}</p>}
            <small className="muted">{e.user_name || 'Sistema'} · {fmtDateTime(e.created_at)}</small>
          </li>
        ))}
      </ol>
    </Card>
  );
}

