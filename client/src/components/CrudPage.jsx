import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './icons.jsx';
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, useAction } from './ui.jsx';

/**
 * Tabla administrable genérica con alta/edición en modal y activación/desactivación.
 * fields: [{ name, label, type: 'text'|'select'|'textarea'|'checkbox', options, required, span }]
 */
export function CrudTable({ title, icon, rows, loading, error, reload, columns, fields, endpoint, empty, defaults = {}, searchKeys = ['name'], extraActions }) {
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [run, busy] = useAction();
  const [formError, setFormError] = useState(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows || []).filter((r) => (showInactive || r.active) && (!s || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(s))));
  }, [rows, q, showInactive, searchKeys]);

  async function save() {
    setFormError(null);
    const { id, ...body } = edit;
    try {
      await run(() => (id ? api.put(`${endpoint}/${id}`, body) : api.post(endpoint, body)), id ? 'Cambios guardados.' : 'Registro creado.');
      setEdit(null);
      reload();
    } catch (e) { setFormError(e); }
  }

  async function toggle(r) {
    const body = Object.fromEntries(fields.map((f) => [f.name, r[f.name]]));
    await run(() => api.put(`${endpoint}/${r.id}`, { ...body, active: !r.active }), r.active ? 'Registro desactivado.' : 'Registro activado.').catch(() => {});
    reload();
  }

  return (
    <Card title={title} icon={icon} actions={<Button size="sm" icon="plus" onClick={() => { setFormError(null); setEdit({ active: true, ...defaults }); }}>Agregar</Button>}>
      <div className="filters">
        <label className="filter-search"><Icon name="search" size={16} /><input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos</label>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !rows ? <Loading /> : filtered.length === 0 ? <Empty title={empty || 'Sin registros.'} /> : (
        <div className="table-wrap">
          <table className="table table-responsive">
            <thead><tr>{columns.map((c) => <th key={c.label} className={c.num ? 'num' : ''}>{c.label}</th>)}<th>Estado</th><th /></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'row-off'}>
                  {columns.map((c) => <td key={c.label} data-label={c.label} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] || '—'}</td>)}
                  <td data-label="Estado"><span className={`badge tone-${r.active ? 'green' : 'gray'}`}>{r.active ? 'Activo' : 'Inactivo'}</span></td>
                  <td className="actions-cell">
                    <div className="row gap">
                      {extraActions?.(r)}
                      <button type="button" className="icon-btn" title="Editar" aria-label="Editar" onClick={() => { setFormError(null); setEdit({ ...r }); }}><Icon name="edit" size={16} /></button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(r)}>{r.active ? 'Desactivar' : 'Activar'}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal title={edit.id ? `Editar ${title.toLowerCase()}` : `Agregar ${title.toLowerCase()}`} onClose={() => setEdit(null)} footer={(
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button busy={busy} onClick={save}>Guardar</Button>
          </>
        )}>
          <div className="form-grid">
            {fields.map((f) => (
              <Field key={f.name} label={f.label} required={f.required} hint={f.hint} className={f.span ? 'span-2' : ''}>
                {f.type === 'select' ? (
                  <select value={edit[f.name] ?? ''} onChange={(e) => setEdit({ ...edit, [f.name]: e.target.value })}>
                    <option value="">{f.placeholder || 'Seleccione'}</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea rows={3} value={edit[f.name] ?? ''} onChange={(e) => setEdit({ ...edit, [f.name]: e.target.value })} />
                ) : (
                  <input type={f.type || 'text'} value={edit[f.name] ?? ''} onChange={(e) => setEdit({ ...edit, [f.name]: e.target.value })} />
                )}
              </Field>
            ))}
            <label className="check span-2"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Activo</label>
          </div>
          <ErrorBox error={formError} />
        </Modal>
      )}
    </Card>
  );
}
