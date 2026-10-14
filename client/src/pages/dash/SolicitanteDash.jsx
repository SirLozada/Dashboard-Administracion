import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import RequisitionTable from '../../components/RequisitionTable.jsx';
import { Card, ErrorBox, Kpi, Loading, PageHeader, useFetch } from '../../components/ui.jsx';
import { useLive } from './useLive.js';

export default function SolicitanteDash() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const resumen = useFetch('/api/requisiciones/resumen');
  const lista = useFetch('/api/requisiciones?por_pagina=10');
  useLive(() => { resumen.reload(); lista.reload(); });
  const s = resumen.data?.solicitante;
  const go = (estado) => navigate(`/requisiciones${estado ? `?estado=${estado}` : ''}`);

  return (
    <>
      <PageHeader title={`Hola, ${user.first_name}`} subtitle={`Requisiciones del departamento de ${user.department_name || '—'}`}>
        <Link to="/requisiciones/nueva" className="btn btn-primary btn-lg"><Icon name="plus" /> Nueva requisición</Link>
      </PageHeader>
      <ErrorBox error={resumen.error} onRetry={resumen.reload} />
      {s?.devueltas > 0 && (
        <button type="button" className="alert alert-warn clickable" onClick={() => go('devuelta_solicitante')}>
          <Icon name="undo" /> Tiene {s.devueltas} requisición(es) devuelta(s) para corrección. Haga clic para revisarlas.
        </button>
      )}
      <div className="kpis">
        <Kpi label="Enviadas" value={s?.enviadas} icon="send" tone="blue" onClick={() => go('')} />
        <Kpi label="Pendientes" value={s?.pendientes} icon="clock" tone="amber" onClick={() => go('pendientes')} />
        <Kpi label="Aprobadas" value={s?.aprobadas} icon="check-circle" tone="green" onClick={() => go('aprobadas')} />
        <Kpi label="Rechazadas" value={s?.rechazadas} icon="x-circle" tone="red" onClick={() => go('rechazada')} />
        <Kpi label="Finalizadas" value={s?.finalizadas} icon="check" tone="dark" onClick={() => go('cerrada')} />
        {s?.borradores > 0 && <Kpi label="Borradores" value={s.borradores} icon="edit" tone="gray" onClick={() => go('borrador')} />}
      </div>
      <Card title="Requisiciones recientes" icon="list" actions={<Link to="/requisiciones" className="btn btn-sm btn-ghost">Ver todas</Link>}>
        <ErrorBox error={lista.error} onRetry={lista.reload} />
        {lista.loading && !lista.data ? <Loading /> : <RequisitionTable rows={lista.data?.items} emptyText="Aún no hay requisiciones. Cree la primera con el botón “Nueva requisición”." />}
      </Card>
    </>
  );
}
