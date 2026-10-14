import { useMemo, useState } from 'react';
import { PERMISOS, ROLES } from '@shared/constants.js';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import { Button, Card, Empty, ErrorBox, Field, Loading, Modal, PageHeader, fmtDateTime, useAction, useFetch } from '../../components/ui.jsx';

const blank = { username: '', email: '', first_name: '', last_name: '', position: '', department_id: '', role: 'solicitante', active: true, password: '', permisos_extra: [] };

export default function Usuarios() {
  const { user: me } = useAuth();
  const { data, loading, error, reload } = useFetch('/api/admin/usuarios');
  const deps = useFetch('/api/admin/departamentos');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [run, busy] = useAction();
  const [formError, setFormError] = useState(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data || []).filter((u) => (!role || u.role === role) && (!s || `${u.first_name} ${u.last_name} ${u.username} ${u.email} ${u.department_name}`.toLowerCase().includes(s)));
  }, [data, q, role]);

  async function save() {
    setFormError(null);
    const { id, ...body } = edit;
    if (!body.password) delete body.password;
    try {
      await run(() => (id ? api.put(`/api/admin/usuarios/${id}`, body) : api.post('/api/admin/usuarios', body)), id ? 'Usuario actualizado.' : 'Usuario creado. Deberá cambiar su contraseña al ingresar.');
      setEdit(null); reload();
    } catch (e) { setFormError(e); }
  }

  async function toggle(u) {
    await run(() => api.put(`/api/admin/usuarios/${u.id}`, { ...u, active: !u.active }), u.active ? 'Usuario desactivado; sus sesiones fueron cerradas.' : 'Usuario activado.').catch(() => {});
    reload();
  }

  const extraPerm = (p) => (edit.permisos_extra.includes(p) ? edit.permisos_extra.filter((x) => x !== p) : [...edit.permisos_extra, p]);

  return (
    <>
      <PageHeader title="Usuarios" subtitle="Cuentas individuales, roles de acceso y estado.">
        <Button icon="plus" onClick={() => { setFormError(null); setEdit({ ...blank }); }}>Nuevo usuario</Button>
      </PageHeader>
      <Card>
        <div className="filters">
          <label className="filter-search"><Icon name="search" size={16} /><input placeholder="Buscar por nombre, usuario, correo o departamento…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Rol">
            <option value="">Todos los roles</option>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : rows.length === 0 ? <Empty icon="users" title="Sin usuarios." /> : (
          <div className="table-wrap">
            <table className="table table-responsive">
              <thead><tr><th>Nombre</th><th>Usuario / correo</th><th>Cargo</th><th>Departamento</th><th>Rol</th><th>Último acceso</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'row-off'}>
                    <td data-label="Nombre"><strong>{u.first_name} {u.last_name}</strong></td>
                    <td data-label="Usuario">{u.username}<div className="muted small">{u.email}</div></td>
                    <td data-label="Cargo">{u.position || '—'}</td>
                    <td data-label="Departamento">{u.department_name || '—'}</td>
                    <td data-label="Rol">{ROLES[u.role]}{u.permisos_extra.length > 0 && <div className="muted small">+{u.permisos_extra.length} permiso(s) individual(es)</div>}</td>
                    <td data-label="Último acceso" className="small">{fmtDateTime(u.last_login_at)}</td>
                    <td data-label="Estado"><span className={`badge tone-${u.active ? 'green' : 'gray'}`}>{u.active ? 'Activo' : 'Inactivo'}</span>{u.must_change_password ? <div className="muted small">Clave temporal</div> : null}</td>
                    <td className="actions-cell">
                      <div className="row gap">
                        <button type="button" className="icon-btn" title="Editar" aria-label="Editar usuario" onClick={() => { setFormError(null); setEdit({ ...u, department_id: u.department_id || '', password: '' }); }}><Icon name="edit" size={16} /></button>
                        {u.id !== me.id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(u)}>{u.active ? 'Desactivar' : 'Activar'}</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {edit && (
        <Modal title={edit.id ? `Editar usuario: ${edit.first_name} ${edit.last_name}` : 'Nuevo usuario'} size="lg" onClose={() => setEdit(null)} footer={(
          <>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button busy={busy} onClick={save}>Guardar</Button>
          </>
        )}>
          <div className="form-grid">
            <Field label="Nombre" required><input value={edit.first_name} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} /></Field>
            <Field label="Apellido" required><input value={edit.last_name} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} /></Field>
            <Field label="Usuario" required hint="Letras minúsculas, números, punto o guion."><input value={edit.username} autoComplete="off" onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
            <Field label="Correo electrónico" required><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Cargo"><input value={edit.position} onChange={(e) => setEdit({ ...edit, position: e.target.value })} /></Field>
            <Field label="Departamento" required={edit.role !== 'superadmin'}>
              <select value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}>
                <option value="">Seleccione</option>
                {deps.data?.filter((d) => d.active || d.id === edit.department_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Rol de acceso" required>
              <select value={edit.role} disabled={edit.id === me.id} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={edit.id ? 'Restablecer contraseña' : 'Contraseña temporal'} required={!edit.id}
              hint={edit.id ? 'Déjela vacía para no cambiarla. Al restablecerla se cerrarán sus sesiones.' : 'Mínimo 8 caracteres con letras y números. Se pedirá cambiarla al ingresar.'}>
              <input type="text" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </Field>
            {edit.id !== me.id && <label className="check span-2"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Usuario activo</label>}
          </div>
          <details className="mt">
            <summary>Permisos individuales adicionales ({edit.permisos_extra.length})</summary>
            <p className="muted small">Se suman a los permisos del rol. Úselos para autorizaciones puntuales, como pagos extraordinarios.</p>
            <div className="perm-list">
              {Object.entries(PERMISOS).map(([k, v]) => (
                <label key={k} className="check"><input type="checkbox" checked={edit.permisos_extra.includes(k)} onChange={() => setEdit({ ...edit, permisos_extra: extraPerm(k) })} /> {v} <code>{k}</code></label>
              ))}
            </div>
          </details>
          <ErrorBox error={formError} />
        </Modal>
      )}
    </>
  );
}
