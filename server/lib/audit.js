import { db, now } from './db.js';

/** Registra una acción administrativa en la bitácora de auditoría. */
export async function audit(req, action, entity, entityId, details, userId) {
  await db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?)',
    [userId ?? req?.user?.id ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null, req?.ip ?? null, now()]);
}
