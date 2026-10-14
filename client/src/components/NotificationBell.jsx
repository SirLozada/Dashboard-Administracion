import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from './icons.jsx';
import { fmtDateTime } from './ui.jsx';

// Evento global para que otras vistas se actualicen cuando llegan novedades.
export const LIVE_EVENT = 'herbaplant:update';

export default function NotificationBell() {
  const [data, setData] = useState({ items: [], no_leidas: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const navigate = useNavigate();

  const load = useCallback(() => api.get('/api/notificaciones?limite=12').then(setData).catch(() => {}), []);

  useEffect(() => {
    load();
    // Tiempo real por SSE; sondeo de respaldo cada 60 s por si la conexión se interrumpe.
    let es;
    try {
      es = new EventSource('/api/eventos');
      es.addEventListener('notification', () => { load(); window.dispatchEvent(new Event(LIVE_EVENT)); });
    } catch { /* navegador sin SSE */ }
    const t = setInterval(load, 60_000);
    return () => { clearInterval(t); es?.close(); };
  }, [load]);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function openItem(n) {
    setOpen(false);
    if (!n.read_at) await api.post(`/api/notificaciones/${n.id}/leer`).catch(() => {});
    load();
    if (n.link) navigate(n.link);
  }

  async function readAll() {
    await api.post('/api/notificaciones/leer-todas').catch(() => {});
    load();
  }

  return (
    <div className="bell" ref={ref}>
      <button type="button" className="icon-btn" onClick={() => setOpen(!open)} aria-label={`Notificaciones (${data.no_leidas} sin leer)`}>
        <Icon name="bell" />
        {data.no_leidas > 0 && <span className="bell-count">{data.no_leidas > 99 ? '99+' : data.no_leidas}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <header>
            <strong>Notificaciones</strong>
            {data.no_leidas > 0 && <button type="button" className="link-btn" onClick={readAll}>Marcar todas como leídas</button>}
          </header>
          <div className="bell-list">
            {data.items.length === 0 && <p className="muted pad">No tiene notificaciones.</p>}
            {data.items.map((n) => (
              <button type="button" key={n.id} className={`bell-item ${n.read_at ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <strong>{n.title}</strong>
                {n.message && <span>{n.message}</span>}
                <time>{fmtDateTime(n.created_at)}</time>
              </button>
            ))}
          </div>
          <footer><button type="button" className="link-btn" onClick={() => { setOpen(false); navigate('/notificaciones'); }}>Ver todas</button></footer>
        </div>
      )}
    </div>
  );
}
