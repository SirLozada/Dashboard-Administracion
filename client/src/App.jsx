import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Perfil from './pages/Perfil.jsx';
import Notificaciones from './pages/Notificaciones.jsx';
import Lista from './pages/requisiciones/Lista.jsx';
import Formulario from './pages/requisiciones/Formulario.jsx';
import Detalle from './pages/requisiciones/Detalle.jsx';
import Pagos from './pages/Pagos.jsx';
import Reportes from './pages/Reportes.jsx';
import Proveedores from './pages/Proveedores.jsx';
import Usuarios from './pages/config/Usuarios.jsx';
import Departamentos from './pages/config/Departamentos.jsx';
import Catalogo from './pages/config/Catalogo.jsx';
import Permisos from './pages/config/Permisos.jsx';
import Auditoria from './pages/config/Auditoria.jsx';
import Parametros from './pages/config/Parametros.jsx';

function Guard({ perms, children }) {
  const { can } = useAuth();
  if (perms && !can(...perms)) {
    return <div className="alert alert-error">No tiene permisos para acceder a esta sección.</div>;
  }
  return children;
}

// Fuerza un formulario nuevo al cambiar entre "nueva" y "editar".
function FormRoute() {
  const { id } = useParams();
  return <Formulario key={id || 'nueva'} />;
}

export default function App() {
  const { loading, user, error, refresh } = useAuth();
  if (loading) return <div className="center-screen"><Loading text="Iniciando…" /></div>;
  if (error && !user) {
    return (
      <div className="center-screen">
        <div className="alert alert-error">{error} <button type="button" className="btn btn-sm btn-ghost" onClick={refresh}>Reintentar</button></div>
      </div>
    );
  }
  if (!user) return <Login />;
  if (user.must_change_password) return <Perfil forced />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="perfil" element={<Perfil />} />
        <Route path="notificaciones" element={<Notificaciones />} />
        <Route path="requisiciones" element={<Guard perms={['req.crear', 'req.ver_departamento', 'req.ver_todas']}><Lista /></Guard>} />
        <Route path="requisiciones/nueva" element={<Guard perms={['req.crear']}><FormRoute /></Guard>} />
        <Route path="requisiciones/:id/editar" element={<Guard perms={['req.crear']}><FormRoute /></Guard>} />
        <Route path="requisiciones/:id" element={<Detalle />} />
        <Route path="pagos" element={<Guard perms={['pagos.gestionar']}><Pagos /></Guard>} />
        <Route path="reportes" element={<Guard perms={['reportes.ver']}><Reportes /></Guard>} />
        <Route path="proveedores" element={<Guard perms={['proveedores.gestionar']}><Proveedores /></Guard>} />
        <Route path="configuracion/usuarios" element={<Guard perms={['admin.usuarios']}><Usuarios /></Guard>} />
        <Route path="configuracion/departamentos" element={<Guard perms={['admin.departamentos']}><Departamentos /></Guard>} />
        <Route path="configuracion/catalogo" element={<Guard perms={['admin.catalogo']}><Catalogo /></Guard>} />
        <Route path="configuracion/permisos" element={<Guard perms={['admin.permisos']}><Permisos /></Guard>} />
        <Route path="configuracion/auditoria" element={<Guard perms={['admin.auditoria']}><Auditoria /></Guard>} />
        <Route path="configuracion/parametros" element={<Guard perms={['admin.parametros']}><Parametros /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
