import { AsyncLocalStorage } from 'node:async_hooks';
import { db, now } from './db.js';

// Tiempo real por SSE cuando el servidor es persistente. En Vercel (sin conexiones largas)
// el cliente consulta periódicamente.
export const REALTIME = !process.env.VERCEL;

// Clientes conectados por SSE: userId -> Set<res>
const streams = new Map();

export function addStream(userId, res) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId).add(res);
  return () => {
    const set = streams.get(userId);
    set?.delete(res);
    if (set && !set.size) streams.delete(userId);
  };
}

export function push(userId, event, data) {
  for (const res of streams.get(userId) || []) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* conexión cerrada */ }
  }
}

/** Usuarios activos que poseen un permiso (por rol o asignación individual). */
export function usersWithPermission(perm) {
  return db.column(`
    SELECT id FROM users WHERE active = 1 AND (
      role IN (SELECT role FROM role_permissions WHERE permission = ?)
      OR id IN (SELECT user_id FROM user_permissions WHERE permission = ?)
    )`, [perm, perm]);
}

// Las notificaciones se insertan dentro de la transacción y se emiten por SSE al confirmarse.
const batches = new AsyncLocalStorage();

export function startNotifications() {
  const batch = { users: new Set(), run: (fn) => batches.run(batch, fn) };
  return batch;
}

export async function notify(userIds, { type, title, message = '', link = null }, { exclude } = {}) {
  const ids = [...new Set(await userIds)].filter((id) => id && id !== exclude);
  for (const uid of ids) {
    await db.run('INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?,?,?,?,?,?)', [uid, type, title, message, link, now()]);
    batches.getStore()?.users.add(uid);
  }
}

export function flushNotifications(batch) {
  for (const uid of batch.users) push(uid, 'notification', { at: now() });
}

export function discardNotifications(batch) { batch.users.clear(); }
