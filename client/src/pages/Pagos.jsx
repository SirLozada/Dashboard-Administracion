import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ESTADOS_PAGO } from '@shared/constants.js';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon } from '../components/icons.jsx';
import {
  Button, Card, ConfirmDialog, Empty, ErrorBox, Field, FileInput, FileLink, Loading, Modal, PageHeader, PaymentBadge,
  fmtDate, fmtDateTime, fmtMoney, todayISO, useAction, useFetch,
} from '../components/ui.jsx';
import { useLive } from './dash/useLive.js';

export default function Pagos() {
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(params.entries());
  const { data, loading, error, reload } = useFetch(`/api/pagos${qs(f)}`);
  const suppliers = useFetch('/api/proveedores?todos=1');
  const [selected, setSelected] = useState(null);
  useLive(reload);

  const set = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  const rows = data?.items || [];
  const totals = {};
  for (const r of rows) {
    const t = (totals[r.currency] ||= { amount: 0, paid: 0, balance: 0 });
    t.amount += r.amount; t.paid += Math.min(r.paid, r.amount); t.balance += r.balance;
  }

  return (
    <>
      <PageHeader title="Pagos de requisiciones" subtitle="Facturas registradas por Compras y control de pagos. Seleccione una factura para programar o registrar pagos." />
      <Card>
        <div className="filters">
          <label className="filter-search">
            <Icon name="search" size={16} />
            <input placeholder="Factura, requisición o proveedor…" defaultValue={f.buscar || ''}
              onKeyDown={(e) => { if (e.key === 'Enter') set('buscar', e.target.value.trim()); }}
              onBlur={(e) => { if ((f.buscar || '') !== e.target.value.trim()) set('buscar', e.target.value.trim()); }} />
          </label>
          <select value={f.estado || ''} onChange={(e) => set('estado', e.target.value)} aria-label="Estado de pago">
            <option value="">Todos los estados</option>
            <option value="abiertas">Con saldo pendiente</option>
            {f.estado && f.estado.includes(',') && <option value={f.estado}>Filtro personalizado</option>}
            {Object.entries(ESTADOS_PAGO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={f.proveedor || ''} onChange={(e) => set('proveedor', e.target.value)} aria-label="Proveedor">
            <option value="">Todos los proveedores</option>
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className="filter-date">Desde <input type="date" value={f.desde || ''} onChange={(e) => set('desde', e.target.value)} /></label>
          <label className="filter-date">Hasta <input type="date" value={f.hasta || ''} onChange={(e) => set('hasta', e.target.value)} /></label>
          {params.toString() && <button type="button" className="link-btn" onClick={() => setParams({}, { replace: true })}>Limpiar filtros</button>}
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : rows.length === 0 ? <Empty icon="receipt" title="No hay facturas con estos filtros." /> : (
          <div className="table-wrap">
            <table className="table table-responsive table-hover">
              <thead>
                <tr><th>N.º requisición</th><th>Proveedor</th><th>Factura</th><th>Fecha factura</th><th className="num">Monto facturado</th><th className="num">Monto pagado</th><th className="num">Saldo pendiente</th><th>Vencimiento</th><th>Estado</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => setSelected(r.id)} className="clickable-row">
                    <td data-label="Requisición"><Link to={`/requisiciones/${r.requisition_id}`} onClick={(e) => e.stopPropagation()} className="strong">{r.requisition_number}</Link></td>
                    <td data-label="Proveedor">{r.supplier_name}</td>
                    <td data-label="Factura"><button type="button" className="link-btn">N.º {r.number}</button></td>
                    <td data-label="Fecha">{fmtDate(r.invoice_date)}</td>
                    <td data-label="Facturado" className="num">{fmtMoney(r.amount, r.currency)}</td>
                    <td data-label="Pagado" className="num">{fmtMoney(r.paid)}</td>
                    <td data-label="Saldo" className="num strong">{fmtMoney(r.balance)}</td>
                    <td data-label="Vence">{fmtDate(r.due_date)}{r.next_scheduled_date && <div className="muted small">Prog.: {fmtDate(r.next_scheduled_date)}</div>}</td>
                    <td data-label="Estado"><PaymentBadge status={r.payment_status} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {Object.entries(totals).map(([cur, t]) => (
                  <tr key={cur}><td colSpan={4} className="strong">Totales {cur}</td><td className="num strong">{fmtMoney(t.amount)}</td><td className="num strong">{fmtMoney(t.paid)}</td><td className="num strong">{fmtMoney(t.balance)}</td><td colSpan={2} /></tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      {selected && <InvoiceDrawer id={selected} metodos={data?.metodos || {}} onClose={() => setSelected(null)} onChange={reload} />}
    </>
  );
}

function InvoiceDrawer({ id, metodos, onClose, onChange }) {
  const { can } = useAuth();
  const { data: inv, loading, error, reload, setData } = useFetch(`/api/pagos/facturas/${id}`);
  const [mode, setMode] = useState(null);
  const [cancel, setCancel] = useState(null);
  const saved = (d) => { setData(d); setMode(null); onChange(); };

  return (
    <Modal title={inv ? `Factura N.º ${inv.number} · ${inv.supplier_name}` : 'Factura'} size="lg" onClose={onClose}>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !inv ? <Loading /> : inv && (
        <>
          <div className="invoice-summary">
            <div><span>Monto facturado</span><strong>{fmtMoney(inv.amount, inv.currency)}</strong></div>
            <div><span>Pagado</span><strong>{fmtMoney(inv.paid, inv.currency)}</strong></div>
            <div><span>Saldo pendiente</span><strong className={inv.balance > 0 ? 'text-warn' : 'text-ok'}>{fmtMoney(inv.balance, inv.currency)}</strong></div>
            <div><span>Estado</span><PaymentBadge status={inv.payment_status} /></div>
          </div>
          <dl className="dl dl-grid">
            <dt>Requisición</dt><dd><Link to={`/requisiciones/${inv.requisition_id}`}>{inv.requisition_number}</Link></dd>
            <dt>Fecha de factura</dt><dd>{fmtDate(inv.invoice_date)}</dd>
            <dt>Vencimiento</dt><dd>{fmtDate(inv.due_date)}</dd>
            <dt>Documento</dt><dd><FileLink url={inv.file_url} name={inv.file_name} /></dd>
            {inv.scheduled > 0 && <><dt>Programado</dt><dd>{fmtMoney(inv.scheduled, inv.currency)}</dd></>}
            {inv.overpaid > 0 && <><dt>Pagado en exceso</dt><dd className="text-warn">{fmtMoney(inv.overpaid, inv.currency)}</dd></>}
          </dl>
          {inv.notes && <p className="muted">{inv.notes}</p>}

          {inv.balance > 0 && !mode && (
            <div className="row gap wrap">
              <Button icon="check" onClick={() => setMode({ type: 'pagar' })}>Registrar pago</Button>
              {inv.balance - inv.scheduled > 0.004 && <Button variant="secondary" icon="calendar" onClick={() => setMode({ type: 'programar' })}>Programar pago</Button>}
            </div>
          )}
          {mode?.type === 'programar' && <ScheduleForm inv={inv} metodos={metodos} onCancel={() => setMode(null)} onSaved={saved} />}
          {mode?.type === 'pagar' && <PayForm inv={inv} metodos={metodos} scheduled={mode.scheduled} canOverride={can('pagos.sobrepago')} onCancel={() => setMode(null)} onSaved={saved} />}

          <h4 className="mt">Pagos y programaciones</h4>
          {inv.payments.length === 0 ? <p className="muted">Sin pagos registrados.</p> : (
            <div className="table-wrap">
              <table className="table table-responsive">
                <thead><tr><th>Estado</th><th>Fecha</th><th className="num">Monto</th><th>Método</th><th>Referencia</th><th>Comprobante</th><th>Registrado por</th><th /></tr></thead>
                <tbody>
                  {inv.payments.map((p) => (
                    <tr key={p.id} className={p.status === 'anulado' ? 'row-off' : ''}>
                      <td data-label="Estado">
                        <span className={`badge tone-${p.status === 'realizado' ? 'green' : p.status === 'programado' ? 'blue' : 'gray'}`}>{p.status === 'realizado' ? 'Pagado' : p.status === 'programado' ? 'Programado' : 'Anulado'}</span>
                        {p.extraordinary && <span className="badge tone-red ml" title={p.extraordinary_reason}>Extraordinario</span>}
                      </td>
                      <td data-label="Fecha">{fmtDate(p.paid_date || p.scheduled_date)}</td>
                      <td data-label="Monto" className="num">{fmtMoney(p.amount, inv.currency)}</td>
                      <td data-label="Método">{metodos[p.method] || p.method || '—'}</td>
                      <td data-label="Referencia">{p.reference || '—'}{p.notes && <div className="muted small">{p.notes}</div>}{p.extraordinary_reason && <div className="small text-warn">Autorización: {p.extraordinary_reason}</div>}</td>
                      <td data-label="Comprobante">{p.file_url ? <FileLink url={p.file_url} name={p.file_name} /> : '—'}</td>
                      <td data-label="Registrado" className="small">{p.updated_by_name || p.created_by_name}<br />{fmtDateTime(p.updated_at || p.created_at)}</td>
                      <td>
                        {p.status === 'programado' && (
                          <div className="row gap">
                            <Button size="sm" onClick={() => setMode({ type: 'pagar', scheduled: p })}>Ejecutar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setCancel(p)}>Anular</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {cancel && (
        <ConfirmDialog title="Anular programación de pago" confirmText="Anular programación" variant="danger" commentLabel="Motivo" commentRequired
          onClose={() => setCancel(null)} onConfirm={async (comment) => saved(await api.post(`/api/pagos/programaciones/${cancel.id}/anular`, { comment }))} />
      )}
    </Modal>
  );
}

function ScheduleForm({ inv, metodos, onCancel, onSaved }) {
  const available = Math.round((inv.balance - inv.scheduled) * 100) / 100;
  const [f, setF] = useState({ amount: available, scheduled_date: inv.due_date > todayISO() ? inv.due_date : todayISO(), method: 'transferencia', notes: '' });
  const [run, busy] = useAction();
  return (
    <div className="subcard">
      <h4>Programar pago</h4>
      <div className="form-grid">
        <Field label="Monto" required hint={`Disponible por programar: ${fmtMoney(available, inv.currency)}`}><input type="number" min="0" step="0.01" max={available} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Fecha programada" required><input type="date" value={f.scheduled_date} onChange={(e) => setF({ ...f, scheduled_date: e.target.value })} /></Field>
        <Field label="Método" required><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(metodos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Observaciones"><input maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="row gap end">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button icon="calendar" busy={busy} disabled={!(Number(f.amount) > 0) || !f.scheduled_date} onClick={() => run(async () => onSaved(await api.post(`/api/pagos/facturas/${inv.id}/programar`, f)), 'Pago programado.')}>Programar</Button>
      </div>
    </div>
  );
}

function PayForm({ inv, metodos, scheduled, canOverride, onCancel, onSaved }) {
  const [f, setF] = useState({
    amount: scheduled ? scheduled.amount : inv.balance, paid_date: todayISO(), method: scheduled?.method || 'transferencia',
    reference: '', notes: '', extraordinary: false, extraordinary_reason: '',
  });
  const [file, setFile] = useState(null);
  const [run, busy] = useAction();
  const [error, setError] = useState(null);
  const over = Number(f.amount) > inv.balance + 0.004;
  const blocked = over && (!f.extraordinary || f.extraordinary_reason.trim().length < 10);

  async function save() {
    setError(null);
    try {
      await run(async () => onSaved(await api.upload(`/api/pagos/facturas/${inv.id}/pagos`, {
        ...f, extraordinary: over && f.extraordinary, scheduled_payment_id: scheduled?.id,
      }, file)), 'Pago registrado.');
    } catch (e) { setError(e); }
  }

  return (
    <div className="subcard">
      <h4>{scheduled ? `Ejecutar pago programado del ${fmtDate(scheduled.scheduled_date)}` : 'Registrar pago realizado'}</h4>
      <div className="form-grid">
        <Field label="Monto pagado" required hint={`Saldo pendiente: ${fmtMoney(inv.balance, inv.currency)}. Puede registrar pagos parciales.`}>
          <input type="number" min="0" step="0.01" value={f.amount} className={over ? 'invalid' : ''} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Fecha de pago" required><input type="date" max={todayISO()} value={f.paid_date} onChange={(e) => setF({ ...f, paid_date: e.target.value })} /></Field>
        <Field label="Método de pago" required><select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(metodos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Referencia" required><input maxLength={120} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="N.º de transferencia, cheque…" /></Field>
        <Field label="Comprobante (opcional)" className="span-2"><FileInput file={file} onChange={setFile} /></Field>
        <Field label="Observaciones" className="span-2"><input maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {over && (
        canOverride ? (
          <div className="alert alert-error column">
            <label className="check"><input type="checkbox" checked={f.extraordinary} onChange={(e) => setF({ ...f, extraordinary: e.target.checked })} /> <strong>Autorizo de forma extraordinaria un pago superior al saldo ({fmtMoney(Number(f.amount) - inv.balance, inv.currency)} en exceso).</strong></label>
            {f.extraordinary && <Field label="Justificación de la autorización" required hint="Quedará registrada en la auditoría."><textarea rows={2} value={f.extraordinary_reason} onChange={(e) => setF({ ...f, extraordinary_reason: e.target.value })} /></Field>}
          </div>
        ) : (
          <div className="alert alert-error">El monto supera el saldo pendiente. Un pago mayor requiere autorización extraordinaria de un usuario habilitado.</div>
        )
      )}
      <ErrorBox error={error} />
      <div className="row gap end">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button icon="check" busy={busy} disabled={!(Number(f.amount) > 0) || !f.reference.trim() || blocked} onClick={save}>Registrar pago</Button>
      </div>
    </div>
  );
}
