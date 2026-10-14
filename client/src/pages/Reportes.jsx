import { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api.js';
import { downloadCsv } from '../components/csv.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, PaymentBadge, fmtDate, fmtMoney, useFetch } from '../components/ui.jsx';

function yearStart() { return `${new Date().getFullYear()}-01-01`; }

export default function Reportes() {
  const [range, setRange] = useState({ desde: yearStart(), hasta: '' });
  const { data, loading, error, reload } = useFetch(`/api/reportes/gastos${qs(range)}`);
  const suffix = `${range.desde || 'inicio'}_${range.hasta || 'hoy'}`;

  const groupCols = (label) => [
    { label, value: 'label' }, { label: 'Moneda', value: 'currency' }, { label: 'Facturas', value: 'facturas' },
    { label: 'Facturado', value: 'facturado' }, { label: 'Pagado', value: 'pagado' }, { label: 'Saldo', value: 'saldo' },
  ];

  return (
    <>
      <PageHeader title="Reportes administrativos" subtitle="Gastos, obligaciones pendientes y pagos. Los montos se agrupan por moneda.">
        <div className="filters inline">
          <label className="filter-date">Desde <input type="date" value={range.desde} onChange={(e) => setRange({ ...range, desde: e.target.value })} /></label>
          <label className="filter-date">Hasta <input type="date" value={range.hasta} onChange={(e) => setRange({ ...range, hasta: e.target.value })} /></label>
        </div>
      </PageHeader>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data && (
        <>
          <div className="aging">
            {[['vencido', 'Vencido', 'red'], ['0-7', 'Vence en 7 días', 'amber'], ['8-30', 'Vence en 8–30 días', 'blue'], ['31+', 'Más de 30 días', 'green']].map(([k, label, tone]) => (
              <div key={k} className={`aging-cell tone-${tone}`}>
                <span>{label}</span>
                <strong>{Object.entries(data.antiguedad[k]).map(([c, v]) => fmtMoney(v, c)).join(' · ') || fmtMoney(0)}</strong>
              </div>
            ))}
          </div>

          <div className="grid-2">
            <GroupTable title="Gasto facturado por departamento" rows={data.por_departamento} cols={groupCols('Departamento')} file={`gasto_departamentos_${suffix}.csv`} />
            <GroupTable title="Gasto facturado por proveedor" rows={data.por_proveedor} cols={groupCols('Proveedor')} file={`gasto_proveedores_${suffix}.csv`} />
          </div>

          <div className="grid-2">
            <Card title="Montos aprobados por departamento" icon="check-circle" actions={<CsvBtn onClick={() => downloadCsv(`aprobado_departamentos_${suffix}.csv`, [
              { label: 'Departamento', value: 'label' }, { label: 'Moneda', value: 'currency' }, { label: 'Requisiciones', value: 'requisiciones' }, { label: 'Aprobado', value: 'aprobado' },
            ], data.aprobado_por_departamento)} />}>
              {data.aprobado_por_departamento.length === 0 ? <Empty title="Sin aprobaciones en el período." /> : (
                <table className="table">
                  <thead><tr><th>Departamento</th><th className="num">Requisiciones</th><th className="num">Aprobado</th></tr></thead>
                  <tbody>{data.aprobado_por_departamento.map((r) => <tr key={`${r.department_id}${r.currency}`}><td>{r.label}</td><td className="num">{r.requisiciones}</td><td className="num">{fmtMoney(r.aprobado, r.currency)}</td></tr>)}</tbody>
                </table>
              )}
            </Card>
            <Card title="Pagos realizados por mes" icon="calendar" actions={<CsvBtn onClick={() => downloadCsv(`pagos_mes_${suffix}.csv`, [
              { label: 'Mes', value: 'mes' }, { label: 'Moneda', value: 'currency' }, { label: 'Pagos', value: 'pagos' }, { label: 'Monto', value: 'pagado' },
            ], data.pagos_por_mes)} />}>
              {data.pagos_por_mes.length === 0 ? <Empty title="Sin pagos en el período." /> : (
                <table className="table">
                  <thead><tr><th>Mes</th><th className="num">Pagos</th><th className="num">Monto</th></tr></thead>
                  <tbody>{data.pagos_por_mes.map((r) => <tr key={`${r.mes}${r.currency}`}><td>{r.mes}</td><td className="num">{r.pagos}</td><td className="num">{fmtMoney(r.pagado, r.currency)}</td></tr>)}</tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title="Obligaciones pendientes de pago" icon="receipt" actions={<CsvBtn onClick={() => downloadCsv('obligaciones_pendientes.csv', [
            { label: 'Requisición', value: 'requisition_number' }, { label: 'Proveedor', value: 'supplier_name' }, { label: 'Factura', value: 'number' },
            { label: 'Vencimiento', value: 'due_date' }, { label: 'Moneda', value: 'currency' }, { label: 'Monto', value: 'amount' }, { label: 'Saldo', value: 'balance' }, { label: 'Estado', value: 'payment_status' },
          ], data.obligaciones)} />}>
            {data.obligaciones.length === 0 ? <Empty title="No hay obligaciones pendientes." /> : (
              <div className="table-wrap">
                <table className="table table-responsive">
                  <thead><tr><th>Requisición</th><th>Proveedor</th><th>Factura</th><th>Vence</th><th className="num">Monto</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
                  <tbody>
                    {data.obligaciones.map((o) => (
                      <tr key={o.id}>
                        <td data-label="Requisición"><Link to={`/requisiciones/${o.requisition_id}`}>{o.requisition_number}</Link></td>
                        <td data-label="Proveedor">{o.supplier_name}</td>
                        <td data-label="Factura">{o.number}</td>
                        <td data-label="Vence">{fmtDate(o.due_date)}</td>
                        <td data-label="Monto" className="num">{fmtMoney(o.amount, o.currency)}</td>
                        <td data-label="Saldo" className="num strong">{fmtMoney(o.balance, o.currency)}</td>
                        <td data-label="Estado"><PaymentBadge status={o.payment_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}

const CsvBtn = ({ onClick }) => <Button size="sm" variant="ghost" icon="download" onClick={onClick}>CSV</Button>;

function GroupTable({ title, rows, cols, file }) {
  return (
    <Card title={title} icon="chart" actions={<CsvBtn onClick={() => downloadCsv(file, cols, rows)} />}>
      {rows.length === 0 ? <Empty title="Sin facturas en el período." /> : (
        <table className="table">
          <thead><tr><th>{cols[0].label}</th><th className="num">Facturado</th><th className="num">Pagado</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.key}${r.currency}`}>
                <td>{r.label}<div className="muted small">{r.facturas} factura(s)</div></td>
                <td className="num">{fmtMoney(r.facturado, r.currency)}</td>
                <td className="num">{fmtMoney(r.pagado, r.currency)}</td>
                <td className="num strong">{fmtMoney(r.saldo, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
