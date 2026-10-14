import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Button, Card, ErrorBox, Loading, PageHeader, useAction, useFetch } from '../../components/ui.jsx';

export default function Permisos() {
  const { data, loading, error, reload } = useFetch('/api/admin/permisos');
  const [matrix, setMatrix] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setMatrix(Object.fromEntries(Object.entries(data.matriz).map(([r, p]) => [r, new Set(p)]))); }, [data]);

  if (loading || !matrix) return error ? <ErrorBox error={error} onRetry={reload} /> : <Loading />;
  const locked = (role, p) => data.bloqueados[role]?.includes(p);
  const toggle = (role, p) => setMatrix((m) => {
    const s = new Set(m[role]);
    if (s.has(p)) s.delete(p); else s.add(p);
    return { ...m, [role]: s };
  });
  const dirty = (role) => {
    const a = new Set(data.matriz[role]); const b = matrix[role];
    return a.size !== b.size || [...a].some((x) => !b.has(x));
  };

  async function saveAll() {
    await run(async () => {
      for (const role of Object.keys(data.roles)) {
        if (dirty(role)) await api.put(`/api/admin/permisos/${role}`, { permisos: [...matrix[role]] });
      }
    }, 'Permisos actualizados. Aplican en la siguiente acción de cada usuario.');
    reload();
  }

  const anyDirty = Object.keys(data.roles).some(dirty);
  return (
    <>
      <PageHeader title="Permisos por rol" subtitle="Defina qué puede hacer cada perfil. Todas las validaciones se aplican en el servidor.">
        <Button icon="check" busy={busy} disabled={!anyDirty} onClick={saveAll}>Guardar cambios</Button>
      </PageHeader>
      <div className="alert alert-info">Los datos financieros (precios, cotizaciones, facturas y pagos) solo son visibles con el permiso “Ver precios, cotizaciones, facturas y pagos”.</div>
      <Card>
        <div className="table-wrap">
          <table className="table matrix">
            <thead><tr><th>Permiso</th>{Object.entries(data.roles).map(([k, v]) => <th key={k} className="center">{v}</th>)}</tr></thead>
            <tbody>
              {Object.entries(data.permisos).map(([p, label]) => (
                <tr key={p}>
                  <td>{label}<div className="muted small"><code>{p}</code></div></td>
                  {Object.keys(data.roles).map((role) => (
                    <td key={role} className="center">
                      <input type="checkbox" aria-label={`${label} — ${data.roles[role]}`} checked={matrix[role].has(p) || locked(role, p)} disabled={locked(role, p)} onChange={() => toggle(role, p)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
