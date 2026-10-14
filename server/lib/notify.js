import { getDb, now } from './db.js';

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
  return getDb().prepare(`
    SELECT id FROM users WHERE active = 1 AND (
      role IN (SELECT role FROM role_permissions WHERE permission = ?)
      OR id IN (SELECT user_id FROM user_permissions WHERE permission = ?)
    )`).pluck().all(perm, perm);
}

// Las notificaciones se insertan dentro de la transacción y se emiten por SSE al confirmarse.
let pending = [];

export function notify(userIds, { type, title, message = '', link = null }, { exclude } = {}) {
  const stmt = getDb().prepare('INSERT INTO notifications (user_id, type, title, message, link, created_at) VALUES (?,?,?,?,?,?)');
  const ids = [...new Set(userIds)].filter((id) => id && id !== exclude);
  for (const uid of ids) {
    stmt.run(uid, type, title, message, link, now());
    pending.push(uid);
  }
}

export function flushNotifications() {
  const users = [...new Set(pending)];
  pending = [];
  for (const uid of users) push(uid, 'notification', { at: now() });
}

export function discardNotifications() { pending = []; }
