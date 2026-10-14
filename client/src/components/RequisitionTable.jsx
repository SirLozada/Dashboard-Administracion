import { Link } from 'react-router-dom';
import { Icon } from './icons.jsx';
import { Empty, PriorityBadge, StatusBadge, fmtDate, fmtMoney } from './ui.jsx';

export default function RequisitionTable({ rows, finance, emptyText = 'No hay requisiciones para mostrar.' }) {
  if (!rows?.length) return <Empty title={emptyText} />;
  return (
    <div className="table-wrap">
      <table className="table table-responsive">
        <thead>
          <tr>
            <th>N.º</th>
            <th>Fecha</th>
            <th>Departamento</th>
            <th>Descripción general</th>
            <th>Prioridad</th>
            <th>Estado</th>
            {finance && <th className="num">Total estimado</th>}
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td data-label="N.º" className="nowrap"><Link to={`/requisiciones/${r.id}`} className="strong">{r.number}</Link></td>
              <td data-label="Fecha">{fmtDate(r.created_at)}</td>
              <td data-label="Departamento">{r.department_name}<div className="muted small">{r.requester_name}</div></td>
              <td data-label="Descripción" className="desc-cell">
                <span>{r.items_preview || 'Sin artículos'}{r.items_count > 3 ? ` y ${r.items_count - 3} más` : ''}</span>
                {r.justification && <div className="muted small clamp">{r.justification}</div>}
              </td>
              <td data-label="Prioridad"><PriorityBadge priority={r.priority} /></td>
              <td data-label="Estado"><StatusBadge status={r.status} /></td>
              {finance && <td data-label="Total" className="num">{r.estimated_total != null ? fmtMoney(r.estimated_total, r.currency) : '—'}</td>}
              <td className="actions-cell">
                <Link to={`/requisiciones/${r.id}`} className="btn btn-sm btn-ghost"><Icon name="eye" size={14} /> Ver detalle</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
