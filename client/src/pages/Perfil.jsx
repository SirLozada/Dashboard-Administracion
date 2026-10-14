import { useState } from 'react';
import { ROLES } from '@shared/constants.js';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Button, Card, ErrorBox, Field, PageHeader, useToast } from '../components/ui.jsx';

export default function Perfil({ forced }) {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ actual: '', nueva: '', confirmar: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (f.nueva !== f.confirmar) { setError(new Error('La confirmación no coincide con la nueva contraseña.')); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/api/auth/cambiar-clave', { actual: f.actual, nueva: f.nueva });
      toast('Contraseña actualizada.');
      setF({ actual: '', nueva: '', confirmar: '' });
      await refresh();
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  const form = (
    <form onSubmit={submit} className="stack">
      <Field label="Contraseña actual" required><input type="password" autoComplete="current-password" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} required /></Field>
      <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres, combinando letras y números."><input type="password" autoComplete="new-password" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} required /></Field>
      <Field label="Confirmar nueva contraseña" required><input type="password" autoComplete="new-password" value={f.confirmar} onChange={(e) => setF({ ...f, confirmar: e.target.value })} required /></Field>
      <ErrorBox error={error} />
      <div className="row gap"><Button type="submit" busy={busy} icon="key">Cambiar contraseña</Button>{forced && <Button variant="ghost" onClick={logout}>Salir</Button>}</div>
    </form>
  );

  if (forced) {
    return (
      <div className="center-screen">
        <div className="login-card">
          <h2>Cambie su contraseña</h2>
          <p className="muted">Por seguridad, debe definir una contraseña personal antes de continuar.</p>
          {form}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Mi perfil" />
      <div className="grid-2">
        <Card title="Datos del usuario" icon="user">
          <dl className="dl">
            <dt>Nombre</dt><dd>{user.full_name}</dd>
            <dt>Usuario</dt><dd>{user.username}</dd>
            <dt>Correo</dt><dd>{user.email}</dd>
            <dt>Cargo</dt><dd>{user.position || '—'}</dd>
            <dt>Departamento</dt><dd>{user.department_name || '—'}</dd>
            <dt>Rol</dt><dd>{ROLES[user.role]}</dd>
          </dl>
        </Card>
        <Card title="Cambiar contraseña" icon="lock">{form}</Card>
      </div>
    </>
  );
}
