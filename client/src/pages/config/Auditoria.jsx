import { useState } from 'react';
import { qs } from '../../api.js';
import { Card, Empty, ErrorBox, Loading, PageHeader, Pagination, fmtDateTime, useFetch } from '../../components/ui.jsx';

export default function Auditoria() {
  const [f, setF] = useState({ entidad: '', accion: '', desde: '', hasta: '', pagina: 1 });
  const { data, loading, error, reload } = useFetch(`/api/admin/auditoria${qs(f)}`);
  const set = (k, v) => setF({ ...f, [k]: v, pagina: k === 'pagina' ? v : 1 });
  return (
    <>
      <PageHeader title="Auditoría" subtitle="Registro de acciones administrativas: accesos, aprobaciones, pagos y cambios de configuración." />
      <Card>
        <div className="filters">
          <select value={f.entidad} onChange={(e) => set('entidad', e.target.value)} aria-label="Entidad">
            <option value="">Todas las entidades</option>
            {data?.entidades.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select value={f.accion} onChange={(e) => set('accion', e.target.value)} aria-label="Acción">
            <option value="">Todas las acciones</option>
            {data?.acciones.map((x) => <option key={x}>{x}</option>)}
          </select>
          <label className="filter-date">Desde <input type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} /></label>
          <label className="filter-date">Hasta <input type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} /></label>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data.items.length === 0 ? <Empty icon="clock" title="Sin registros." /> : (
          <>
            <div className="table-wrap">
              <table className="table table-responsive">
                <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>IP</th></tr></thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td data-label="Fecha" className="small nowrap">{fmtDateTime(a.created_at)}</td>
                      <td data-label="Usuario">{a.user_name || 'Sistema'}<div className="muted small">{a.username}</div></td>
                      <td data-label="Acción"><span className={`badge tone-${a.action.includes('extraordinario') || a.action.includes('fallido') ? 'red' : 'blue'}`}>{a.action}</span></td>
                      <td data-label="Entidad">{a.entity}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                      <td data-label="Detalle" className="small mono wrap-any">{a.details ? Object.entries(JSON.parse(a.details)).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '—'}</td>
                      <td data-label="IP" className="small">{a.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination total={data.total} page={data.pagina} perPage={data.por_pagina} onChange={(p) => set('pagina', p)} />
          </>
        )}
      </Card>
    </>
  );
}
