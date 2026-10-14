import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Button, Card, ErrorBox, Field, Loading, PageHeader, useAction, useFetch } from '../../components/ui.jsx';

export default function Parametros() {
  const { refresh } = useAuth();
  const { data, loading, error, reload } = useFetch('/api/admin/parametros');
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  const [formError, setFormError] = useState(null);
  useEffect(() => { if (data) setF(data); }, [data]);
  if (loading || !f) return error ? <ErrorBox error={error} onRetry={reload} /> : <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setFormError(null);
    try { await run(() => api.put('/api/admin/parametros', f), 'Parámetros guardados.'); refresh(); } catch (e) { setFormError(e); }
  }

  return (
    <>
      <PageHeader title="Parámetros generales" subtitle="Configuración global del sistema. Los cambios quedan registrados en la auditoría." />
      <Card>
        <div className="form-grid">
          <Field label="Nombre de la empresa" required className="span-2"><input value={f.empresa_nombre} onChange={set('empresa_nombre')} /></Field>
          <Field label="Prefijo de requisiciones" hint="Ej.: REQ → REQ-2026-00001"><input value={f.req_prefijo} onChange={set('req_prefijo')} /></Field>
          <Field label="Moneda principal"><input value={f.moneda_principal} onChange={set('moneda_principal')} /></Field>
          <Field label="Monedas habilitadas" hint="Códigos ISO separados por coma."><input value={f.monedas} onChange={set('monedas')} /></Field>
          <Field label="Días de crédito por defecto" hint="Para calcular el vencimiento de facturas."><input type="number" min="0" value={f.dias_credito} onChange={set('dias_credito')} /></Field>
          <Field label="Tolerancia de sobrecosto en compras (%)" hint="Margen permitido sobre el monto aprobado antes de exigir nueva aprobación."><input type="number" min="0" max="100" step="0.5" value={f.tolerancia_sobrecosto_pct} onChange={set('tolerancia_sobrecosto_pct')} /></Field>
          <Field label="Tamaño máximo de archivos (MB)"><input type="number" min="1" max="50" value={f.max_archivo_mb} onChange={set('max_archivo_mb')} /></Field>
          <Field label="Duración de la sesión (horas)"><input type="number" min="1" max="72" value={f.sesion_horas} onChange={set('sesion_horas')} /></Field>
        </div>
        <ErrorBox error={formError} />
        <div className="row end"><Button icon="check" busy={busy} onClick={save}>Guardar parámetros</Button></div>
      </Card>
    </>
  );
}
