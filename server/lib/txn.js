import { tx } from './db.js';
import { discardNotifications, flushNotifications, startNotifications } from './notify.js';

/** Ejecuta un caso de uso en una transacción y emite las notificaciones solo si se confirma. */
export async function txn(fn) {
  const batch = startNotifications();
  try {
    const out = await tx(() => batch.run(fn));
    flushNotifications(batch);
    return out;
  } catch (err) {
    discardNotifications(batch);
    throw err;
  }
}
