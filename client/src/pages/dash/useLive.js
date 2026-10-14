import { useEffect } from 'react';
import { LIVE_EVENT } from '../../components/NotificationBell.jsx';

/** Recarga los datos cuando llega una novedad en tiempo real o la ventana recupera el foco. */
export function useLive(reload) {
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener(LIVE_EVENT, reload);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener(LIVE_EVENT, reload); document.removeEventListener('visibilitychange', onFocus); };
  }, [reload]);
}
