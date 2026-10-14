import { tx } from './db.js';
import { discardNotifications, flushNotifications } from './notify.js';

/** Ejecuta un caso de uso en una transacción y emite las notificaciones solo si se confirma. */
export function txn(fn) {
  try {
    const out = tx(fn);
    flushNotifications();
    return out;
  } catch (err) {
    discardNotifications();
    throw err;
  }
}
