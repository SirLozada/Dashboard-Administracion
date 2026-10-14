import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import RequisitionTable from '../../components/RequisitionTable.jsx';
import { Card, ErrorBox, Kpi, Loading, PageHeader, moneyMap, useFetch } from '../../components/ui.jsx';
import { useLive } from './useLive.js';

export default function AdminDash() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const resumen = useFetch('/api/requisiciones/resumen');
  const pendientes = useFetch('/api/requisiciones?estado=pendiente_aprobacion&por_pagina=20');
  useLive(() => { resumen.reload(); pendientes.reload(); });
  const a = resumen.data?.administracion;
  const go = (estado) => navigate(`/requisiciones?estado=${estado}`);
  const pagos = (estado) => navigate(`/pagos${estado ? `?estado=${estado}` : ''}`);

  return (
    <>
      <PageHeader title="Panel de Administración" subtitle={`Bienvenido(a), ${user.first_name}. Aprobaciones, facturas y pagos.`}>
        {can('pagos.gestionar') && <Link to="/pagos" className="btn btn-primary">Pagos de requisiciones</Link>}
      </PageHeader>
      <ErrorBox error={resumen.error} onRetry={resumen.reload} />
      <div className="kpis">
        <Kpi label="Pendientes de aprobación" value={a?.pendientes_aprobacion} icon="clock" tone="amber" onClick={() => go('pendiente_aprobacion')} />
        <Kpi label="Aprobadas" value={a?.aprobadas} icon="check-circle" tone="green" onClick={() => go('aprobadas,cerrada')} />
        <Kpi label="Rechazadas" value={a?.rechazadas} icon="x-circle" tone="red" onClick={() => go('rechazada')} />
        <Kpi label="En proceso de compra" value={a?.en_compra} icon="cart" tone="teal" onClick={() => go('aprobada,en_compra,compra_parcial,compra_ejecutada')} />
        <Kpi label="Facturas pendientes" value={a?.facturas_pendientes} icon="receipt" tone="purple" hint={a?.facturas_vencidas ? `${a.facturas_vencidas} vencida(s)` : undefined} onClick={() => pagos('pendiente,vencido')} />
        <Kpi label="Pagos pendientes" value={a?.pagos_pendientes} icon="dollar" tone="orange" hint={a ? moneyMap(a.pagos_pendientes_monto) : undefined} onClick={() => pagos('abiertas')} />
        <Kpi label="Pagos realizados" value={a?.pagos_realizados} icon="check" tone="dark" hint={a ? moneyMap(a.pagos_realizados_monto) : undefined} onClick={() => pagos('pagado')} />
      </div>
      <div className="highlight">
        <span>Monto comprometido pendiente de pago</span>
        <strong>{a ? moneyMap(a.comprometido) : '—'}</strong>
        <small>Montos aprobados aún no facturados + saldos de facturas por pagar.</small>
      </div>
      <Card title="Requisiciones pendientes de aprobación" icon="clock">
        <ErrorBox error={pendientes.error} onRetry={pendientes.reload} />
        {pendientes.loading && !pendientes.data ? <Loading /> : <RequisitionTable rows={pendientes.data?.items} finance emptyText="No hay requisiciones pendientes de aprobación." />}
      </Card>
    </>
  );
}
