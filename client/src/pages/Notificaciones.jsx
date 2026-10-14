import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Button, Card, Empty, ErrorBox, Loading, PageHeader, fmtDateTime, useFetch } from '../components/ui.jsx';

export default function Notificaciones() {
  const { data, loading, error, reload } = useFetch('/api/notificaciones?limite=200');
  const navigate = useNavigate();
  async function open(n) {
    if (!n.read_at) await api.post(`/api/notificaciones/${n.id}/leer`).catch(() => {});
    if (n.link) navigate(n.link); else reload();
  }
  return (
    <>
      <PageHeader title="Notificaciones" subtitle="Avisos internos sobre sus requisiciones y tareas pendientes.">
        <Button variant="ghost" icon="check" onClick={async () => { await api.post('/api/notificaciones/leer-todas'); reload(); }}>Marcar todas como leídas</Button>
      </PageHeader>
      <Card>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Loading /> : data?.items.length === 0 ? <Empty icon="bell" title="Sin notificaciones" /> : (
          <ul className="notif-list">
            {data?.items.map((n) => (
              <li key={n.id} className={n.read_at ? '' : 'unread'}>
                <button type="button" onClick={() => open(n)}>
                  <strong>{n.title}</strong>
                  {n.message && <span>{n.message}</span>}
                  <time>{fmtDateTime(n.created_at)}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
