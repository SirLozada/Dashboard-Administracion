import { getDb, now } from './db.js';

/** Registra una acción administrativa en la bitácora de auditoría. */
export function audit(req, action, entity, entityId, details, userId) {
  getDb().prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(userId ?? req?.user?.id ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null, req?.ip ?? null, now());
}
