import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { Logo } from '../components/icons.jsx';
import { Button, ErrorBox, Field } from '../components/ui.jsx';

export default function Login() {
  const { login, expired } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(usuario.trim(), password); } catch (err) { setError(err); setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-art">
        <div>
          <Logo size={56} />
          <h1>Laboratorios Herbaplant</h1>
          <p>Sistema de Gestión Administrativa</p>
          <ul>
            <li>Requisiciones de bienes, insumos y servicios</li>
            <li>Revisión y cotización por Compras</li>
            <li>Aprobación, facturas y pagos por Administración</li>
          </ul>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>Iniciar sesión</h2>
        <p className="muted">Ingrese con su usuario corporativo.</p>
        {expired && <div className="alert alert-warn">Su sesión expiró. Inicie sesión nuevamente.</div>}
        <Field label="Usuario o correo electrónico">
          <input autoFocus autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
        </Field>
        <Field label="Contraseña">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" busy={busy} className="btn-block">Ingresar</Button>
        <p className="muted small">¿Olvidó su contraseña? Solicite el restablecimiento al administrador del sistema.</p>
      </form>
    </div>
  );
}
