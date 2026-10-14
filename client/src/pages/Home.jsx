import { useAuth } from '../auth.jsx';
import SolicitanteDash from './dash/SolicitanteDash.jsx';
import ComprasDash from './dash/ComprasDash.jsx';
import AdminDash from './dash/AdminDash.jsx';
import SuperDash from './dash/SuperDash.jsx';

export default function Home() {
  const { can } = useAuth();
  if (can('req.aprobar')) return <AdminDash />;
  if (can('req.revisar', 'compras.ejecutar')) return <ComprasDash />;
  if (can('req.crear')) return <SolicitanteDash />;
  return <SuperDash />;
}
