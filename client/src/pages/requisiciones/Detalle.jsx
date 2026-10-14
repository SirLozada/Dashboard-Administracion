import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ESTADOS, FLUJO } from '@shared/constants.js';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import {
  Button, Card, ConfirmDialog, ErrorBox, FileLink, Loading, PageHeader, PriorityBadge, StatusBadge,
  fmtDate, fmtDateTime, fmtMoney, fmtQty, useFetch, useToast,
} from '../../components/ui.jsx';
import { useLive } from '../dash/useLive.js';
import { CatalogPanel, DecisionPanel, InvoicesPanel, PurchasesPanel, QuotationsPanel, ReviewPanel, Timeline } from './panels.jsx';

export default function Detalle() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: r, loading, error, reload, setData } = useFetch(`/api/requisiciones/${id}`);
  const [dialog, setDialog] = useState(null);
  useLive(reload);

  if (loading && !r) return <Loading />;
  if (error && !r) return <ErrorBox error={error} onRetry={reload} />;
  if (!r) return null;

  const finance = can('req.ver_finanzas');
  const has = (a) => r.actions.includes(a);
  const act = (url, body, msg) => async (comment) => {
    const res = await api.post(`/api/requisiciones/${r.id}/${url}`, body ? body(comment) : { comment });
    setData(res);
    toast(msg);
  };
  const step = ESTADOS[r.status]?.paso || 0;
  const returned = ['devuelta_solicitante', 'devuelta_compras'].includes(r.status);

  return (
    <>
      <PageHeader
        title={<>Requisición {r.number} <StatusBadge status={r.status} /></>}
        subtitle={`${r.department_name} · ${r.requester_name} · creada el ${fmtDateTime(r.created_at)}`}
        back={<button type="button" className="back-link" onClick={() => navigate(-1)}><Icon name="chevron-left" size={14} /> Volver</button>}
      >
        {has('editar') && <Link to={`/requisiciones/${r.id}/editar`} className="btn btn-primary"><Icon name="edit" size={16} /> {r.status === 'borrador' ? 'Editar borrador' : 'Corregir requisición'}</Link>}
        {has('enviar') && r.status === 'borrador' && (
          <Button icon="send" variant="secondary" onClick={() => setDialog({
            title: 'Enviar requisición a Compras', message: `Se enviará la requisición ${r.number} con ${r.items.length} artículo(s).`,
            confirmText: 'Enviar', onConfirm: act('enviar', () => ({}), 'Requisición enviada a Compras.'),
          })}>Enviar</Button>
        )}
        {has('anular') && (
          <Button icon="x" variant="ghost" onClick={() => setDialog({
            title: 'Anular requisición', message: 'La requisición quedará anulada y no podrá reactivarse. Se conserva en el historial.',
            confirmText: 'Anular', variant: 'danger', commentLabel: 'Motivo (opcional)', onConfirm: act('anular', null, 'Requisición anulada.'),
          })}>Anular</Button>
        )}
        {has('recibir') && (
          <Button icon="inbox" onClick={() => setDialog({
            title: 'Recibir requisición', message: 'Se notificará al solicitante que Compras inició la revisión.', confirmText: 'Recibir e iniciar revisión',
            onConfirm: act('recibir', () => ({}), 'Requisición recibida. Puede iniciar la revisión.'),
          })}>Recibir e iniciar revisión</Button>
        )}
        {has('devolver_solicitante') && (
          <Button icon="undo" variant="ghost" onClick={() => setDialog({
            title: 'Solicitar aclaratoria o corrección al departamento', confirmText: 'Devolver al solicitante', variant: 'warn',
            message: 'La requisición regresará al departamento para que la corrija o aclare.',
            commentLabel: 'Indique qué debe corregir o aclarar', commentRequired: true,
            onConfirm: act('devolver-solicitante', null, 'Requisición devuelta al departamento.'),
          })}>Solicitar corrección</Button>
        )}
        {has('iniciar_compra') && (
          <Button icon="cart" onClick={() => setDialog({
            title: 'Iniciar proceso de compra', message: 'La requisición pasará a "En proceso de compra".', confirmText: 'Iniciar compra',
            onConfirm: act('iniciar-compra', () => ({}), 'Proceso de compra iniciado.'),
          })}>Iniciar compra</Button>
        )}
        {has('cerrar') && (
          <Button icon="check" onClick={() => setDialog({
            title: 'Cerrar requisición', message: 'La requisición está pagada en su totalidad. Al cerrarla finaliza el proceso.', confirmText: 'Cerrar requisición',
            commentLabel: 'Observación (opcional)', onConfirm: act('cerrar', null, 'Requisición cerrada.'),
          })}>Cerrar requisición</Button>
        )}
      </PageHeader>

      {r.status !== 'anulada' && r.status !== 'rechazada' && (
        <ol className={`stepper ${returned ? 'stepper-returned' : ''}`} aria-label="Progreso">
          {FLUJO.map((label, i) => {
            const n = i + 1;
            const state = n < step || r.status === 'cerrada' ? 'done' : n === step ? 'current' : '';
            return <li key={label} className={state}><span>{n}</span><small>{label}</small></li>;
          })}
        </ol>
      )}

      {returned && (() => {
        const last = r.events.filter((e) => e.to_status === r.status).pop();
        return last ? (
          <div className="alert alert-warn"><Icon name="undo" />
            <div><strong>{ESTADOS[r.status].label} por {last.user_name}</strong> ({fmtDateTime(last.created_at)}): {last.comment}</div>
          </div>
        ) : null;
      })()}
      {r.status === 'rechazada' && (
        <div className="alert alert-error"><Icon name="x-circle" /><div><strong>Rechazada por {r.decided_by_name}</strong> ({fmtDateTime(r.decided_at)}): {r.decision_notes}</div></div>
      )}
      {has('decision_bloqueada') && (
        <div className="alert alert-warn"><Icon name="lock" /> Por segregación de funciones, usted no puede decidir sobre esta requisición porque la revisó o la solicitó.</div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <Card title="Información general" icon="file">
            <dl className="dl dl-grid">
              <dt>Departamento</dt><dd>{r.department_name}</dd>
              <dt>Solicitante</dt><dd>{r.requester_name}</dd>
              <dt>Fecha requerida</dt><dd>{fmtDate(r.required_date)}</dd>
              <dt>Prioridad</dt><dd><PriorityBadge priority={r.priority} /></dd>
              <dt>Enviada</dt><dd>{fmtDateTime(r.submitted_at)}</dd>
              <dt>Recibida por Compras</dt><dd>{r.received_by_name ? `${r.received_by_name} · ${fmtDateTime(r.received_at)}` : '—'}</dd>
              <dt>Revisada por</dt><dd>{r.reviewed_by_name ? `${r.reviewed_by_name} · ${fmtDateTime(r.reviewed_at)}` : '—'}</dd>
              <dt>Decisión</dt><dd>{r.decided_by_name ? `${r.decided_by_name} · ${fmtDateTime(r.decided_at)}` : '—'}</dd>
              {finance && <><dt>Total estimado</dt><dd className="strong">{fmtMoney(r.estimated_total, r.currency)}</dd></>}
              {finance && r.approved_total != null && <><dt>Monto aprobado</dt><dd className="strong">{fmtMoney(r.approved_total, r.currency)}</dd></>}
            </dl>
            <h4 className="mt">Motivo o justificación</h4>
            <p className="prewrap">{r.justification || '—'}</p>
            {finance && r.purchasing_notes && (<><h4 className="mt">Observaciones de Compras</h4><p className="prewrap">{r.purchasing_notes}</p></>)}
            {r.decision_notes && r.status !== 'rechazada' && (<><h4 className="mt">Observaciones de Administración</h4><p className="prewrap">{r.decision_notes}</p></>)}
          </Card>

          {has('revisar') ? (
            <ReviewPanel r={r} onSaved={setData} />
          ) : (
            <ItemsCard r={r} finance={finance} />
          )}

          {has('validar_catalogo') && <CatalogPanel r={r} onSaved={setData} />}
          {finance && (r.quotations?.length > 0 || has('cotizar')) && <QuotationsPanel r={r} canEdit={has('cotizar')} onSaved={setData} />}
          {(has('aprobar') || has('rechazar')) && <DecisionPanel r={r} onSaved={setData} />}
          {finance && (r.purchases?.length > 0 || has('registrar_compra')) && <PurchasesPanel r={r} actions={r.actions} onSaved={setData} />}
          {finance && (r.invoices?.length > 0 || has('cargar_factura')) && <InvoicesPanel r={r} canUpload={has('cargar_factura')} onSaved={setData} />}
        </div>

        <aside className="detail-side">
          {r.attachments.length > 0 && (
            <Card title="Documentos adjuntos" icon="file">
              <ul className="files">
                {r.attachments.map((f) => (
                  <li key={f.uuid}><FileLink url={f.url} name={f.original_name} /><span className="muted small">{KIND[f.kind]} · {fmtDate(f.created_at)}</span></li>
                ))}
              </ul>
            </Card>
          )}
          <Timeline r={r} onSaved={setData} />
        </aside>
      </div>

      {dialog && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

const KIND = { referencia: 'Referencia', cotizacion: 'Cotización', factura: 'Factura', comprobante: 'Comprobante de pago' };

function ItemsCard({ r, finance }) {
  const showApproved = r.items.some((it) => it.approved_quantity != null && it.approved_quantity !== it.quantity);
  const showPurchased = r.items.some((it) => it.purchased_quantity > 0);
  return (
    <Card title="Artículos solicitados" icon="box" actions={<span className="muted small">{r.items.length} artículo(s)</span>}>
      <div className="table-wrap">
        <table className="table table-responsive">
          <thead>
            <tr>
              <th>#</th><th>Artículo</th><th className="num">Cantidad</th>
              {showApproved && <th className="num">Validada</th>}
              {showPurchased && <th className="num">Adquirida</th>}
              <th>Especificaciones</th>
              {finance && <th>Proveedor sugerido</th>}
              {finance && <th className="num">Precio unit.</th>}
              {finance && <th className="num">Total</th>}
            </tr>
          </thead>
          <tbody>
            {r.items.map((it, i) => (
              <tr key={it.id}>
                <td data-label="#">{i + 1}</td>
                <td data-label="Artículo">
                  <strong>{it.item_name}</strong>
                  {it.is_unregistered && <span className={`badge ml tone-${it.catalog_review === 'incorporado' ? 'green' : 'orange'}`}>{it.catalog_review === 'incorporado' ? 'Incorporado al catálogo' : 'No registrado'}</span>}
                  <div className="muted small">{it.category_name}</div>
                  {it.description && <div className="muted small">{it.description}</div>}
                  {it.reference_file && <FileLink url={it.reference_file.url} name={it.reference_file.original_name} />}
                </td>
                <td data-label="Cantidad" className="num">{fmtQty(it.quantity)} {it.unit_name}</td>
                {showApproved && <td data-label="Validada" className="num">{it.approved_quantity != null ? fmtQty(it.approved_quantity) : '—'}</td>}
                {showPurchased && <td data-label="Adquirida" className="num">{fmtQty(it.purchased_quantity)}</td>}
                <td data-label="Especificaciones">
                  {it.specifications || '—'}
                  {it.purchasing_comment && <div className="note"><Icon name="message" size={12} /> Compras: {it.purchasing_comment}</div>}
                </td>
                {finance && <td data-label="Proveedor">{it.supplier_name || '—'}</td>}
                {finance && <td data-label="Precio unit." className="num">{fmtMoney(it.estimated_unit_price)}</td>}
                {finance && <td data-label="Total" className="num">{fmtMoney(it.estimated_line_total)}</td>}
              </tr>
            ))}
          </tbody>
          {finance && r.estimated_total > 0 && (
            <tfoot><tr><td colSpan={99} className="num strong">Total estimado: {fmtMoney(r.estimated_total, r.currency)}</td></tr></tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}

