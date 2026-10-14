import { Link, useSearchParams } from 'react-router-dom';
import { ESTADOS, PRIORIDADES } from '@shared/constants.js';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import RequisitionTable from '../../components/RequisitionTable.jsx';
import { Card, ErrorBox, Loading, PageHeader, Pagination, useFetch } from '../../components/ui.jsx';
import { qs } from '../../api.js';
import { useLive } from '../dash/useLive.js';

const GRUPOS_LABEL = { pendientes: 'Todas las pendientes', aprobadas: 'Aprobadas y en ejecución' };

export default function Lista() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(params.entries());
  const finance = can('req.ver_finanzas');
  const deps = useFetch(can('req.ver_todas') ? '/api/departamentos' : null);
  const { data, loading, error, reload } = useFetch(`/api/requisiciones${qs({ ...f, por_pagina: 25 })}`);
  useLive(reload);

  const set = (k, v) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'pagina') next.delete('pagina');
    setParams(next, { replace: true });
  };

  const estadoKnown = !f.estado || ESTADOS[f.estado] || GRUPOS_LABEL[f.estado];

  return (
    <>
      <PageHeader title="Requisiciones" subtitle={can('req.ver_todas') ? 'Todas las requisiciones de la organización' : 'Requisiciones de su departamento'}>
        {can('req.crear') && <Link to="/requisiciones/nueva" className="btn btn-primary"><Icon name="plus" /> Nueva requisición</Link>}
      </PageHeader>
      <Card>
        <div className="filters">
          <label className="filter-search">
            <Icon name="search" size={16} />
            <input placeholder="Buscar por número, artículo o motivo…" defaultValue={f.buscar || ''}
              onKeyDown={(e) => { if (e.key === 'Enter') set('buscar', e.target.value.trim()); }}
              onBlur={(e) => { if ((f.buscar || '') !== e.target.value.trim()) set('buscar', e.target.value.trim()); }} />
          </label>
          <select value={f.estado || ''} onChange={(e) => set('estado', e.target.value)} aria-label="Estado">
            <option value="">Todos los estados</option>
            {!estadoKnown && <option value={f.estado}>Filtro personalizado</option>}
            {Object.entries(GRUPOS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            <optgroup label="Estado">
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </optgroup>
          </select>
          {deps.data && (
            <select value={f.departamento || ''} onChange={(e) => set('departamento', e.target.value)} aria-label="Departamento">
              <option value="">Todos los departamentos</option>
              {deps.data.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <select value={f.prioridad || ''} onChange={(e) => set('prioridad', e.target.value)} aria-label="Prioridad">
            <option value="">Toda prioridad</option>
            {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="filter-date">Desde <input type="date" value={f.desde || ''} onChange={(e) => set('desde', e.target.value)} /></label>
          <label className="filter-date">Hasta <input type="date" value={f.hasta || ''} onChange={(e) => set('hasta', e.target.value)} /></label>
          {can('req.crear') && (
            <label className="check"><input type="checkbox" checked={f.mias === '1'} onChange={(e) => set('mias', e.target.checked ? '1' : '')} /> Solo mías</label>
          )}
          {params.toString() && <button type="button" className="link-btn" onClick={() => setParams({}, { replace: true })}>Limpiar filtros</button>}
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : (
          <>
            <RequisitionTable rows={data?.items} finance={finance} />
            {data && <Pagination total={data.total} page={data.pagina} perPage={data.por_pagina} onChange={(p) => set('pagina', String(p))} />}
          </>
        )}
      </Card>
    </>
  );
}
