import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import RequisitionTable from '../../components/RequisitionTable.jsx';
import { Card, ErrorBox, Kpi, Loading, PageHeader, useFetch } from '../../components/ui.jsx';
import { useLive } from './useLive.js';

export default function ComprasDash() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const resumen = useFetch('/api/requisiciones/resumen');
  const bandeja = useFetch('/api/requisiciones?estado=enviada,en_revision,devuelta_compras&por_pagina=15');
  const ejecucion = useFetch('/api/requisiciones?estado=aprobada,en_compra,compra_parcial,compra_ejecutada,facturada&por_pagina=15');
  useLive(() => { resumen.reload(); bandeja.reload(); ejecucion.reload(); });
  const c = resumen.data?.compras;
  const go = (estado) => navigate(`/requisiciones?estado=${estado}`);

  return (
    <>
      <PageHeader title="Panel de Compras" subtitle={`Bienvenido(a), ${user.first_name}. Requisiciones de todos los departamentos.`} />
      <ErrorBox error={resumen.error} onRetry={resumen.reload} />
      <div className="kpis">
        <Kpi label="Nuevas" value={c?.nuevas} icon="inbox" tone="blue" onClick={() => go('enviada')} />
        <Kpi label="Pendientes de revisión" value={c?.en_revision} icon="search" tone="indigo" onClick={() => go('en_revision')} />
        <Kpi label="Devueltas" value={c?.devueltas} icon="undo" tone="orange" hint={c ? `${c.devueltas_compras} por Administración` : undefined} onClick={() => go('devuelta_compras,devuelta_solicitante')} />
        <Kpi label="Enviadas a Administración" value={c?.enviadas_administracion} icon="send" tone="amber" onClick={() => go('pendiente_aprobacion')} />
        <Kpi label="Aprobadas por ejecutar" value={c?.aprobadas_por_ejecutar} icon="check-circle" tone="green" onClick={() => go('aprobada')} />
        <Kpi label="Compras en proceso" value={c?.en_proceso} icon="cart" tone="teal" onClick={() => go('en_compra,compra_parcial')} />
        <Kpi label="Ejecutadas pendientes de factura" value={c?.pendientes_factura} icon="receipt" tone="purple" onClick={() => go('compra_parcial,compra_ejecutada,facturada')} />
      </div>
      <Card title="Bandeja de revisión" icon="inbox" actions={<Link to="/requisiciones?estado=enviada,en_revision,devuelta_compras" className="btn btn-sm btn-ghost">Filtrar bandeja</Link>}>
        <ErrorBox error={bandeja.error} onRetry={bandeja.reload} />
        {bandeja.loading && !bandeja.data ? <Loading /> : <RequisitionTable rows={bandeja.data?.items} finance emptyText="No hay requisiciones pendientes de revisión." />}
      </Card>
      <Card title="Compras aprobadas y en ejecución" icon="cart">
        <ErrorBox error={ejecucion.error} onRetry={ejecucion.reload} />
        {ejecucion.loading && !ejecucion.data ? <Loading /> : <RequisitionTable rows={ejecucion.data?.items} finance emptyText="No hay compras en ejecución." />}
      </Card>
    </>
  );
}
