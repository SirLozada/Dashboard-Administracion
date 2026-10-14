import { Link } from 'react-router-dom';
import { ESTADOS } from '@shared/constants.js';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/icons.jsx';
import { NAV } from '../../modules.js';
import { Card, ErrorBox, PageHeader, StatusBadge, useFetch } from '../../components/ui.jsx';

export default function SuperDash() {
  const { user, can } = useAuth();
  const resumen = useFetch(can('req.ver_todas', 'req.ver_departamento') ? '/api/requisiciones/resumen' : null);
  const config = NAV.find((s) => s.section === 'Configuración').items.filter((i) => can(...i.perms));
  const por = resumen.data?.por_estado || {};
  return (
    <>
      <PageHeader title={`Hola, ${user.first_name}`} subtitle="Administración del sistema" />
      <div className="tiles">
        {config.map((i) => (
          <Link key={i.to} to={i.to} className="tile"><Icon name={i.icon} size={26} /><strong>{i.label}</strong></Link>
        ))}
      </div>
      {resumen.data && (
        <Card title="Requisiciones por estado" icon="list">
          <ErrorBox error={resumen.error} />
          <div className="status-grid">
            {Object.keys(ESTADOS).filter((s) => por[s]).map((s) => (
              <Link key={s} to={`/requisiciones?estado=${s}`} className="status-row"><StatusBadge status={s} /><strong>{por[s]}</strong></Link>
            ))}
            {!Object.keys(por).length && <p className="muted">Aún no hay requisiciones registradas.</p>}
          </div>
        </Card>
      )}
    </>
  );
}
