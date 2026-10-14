import crypto from 'node:crypto';
import { getDb, now } from './db.js';
import { HttpError, forbidden } from './errors.js';
import { getSetting } from './settings.js';
import { PERMISOS_BLOQUEADOS_SUPERADMIN } from '../../shared/constants.js';

export const COOKIE = 'hp_session';

// ---------- Contraseñas (scrypt) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'La contraseña debe combinar letras y números.';
  return null;
}

// ---------- Sesiones ----------
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = Number(getSetting('sesion_horas')) || 12;
  const expires = new Date(Date.now() + hours * 3600_000).toISOString();
  getDb().prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)')
    .run(sha256(token), userId, now(), expires, req.ip, String(req.get('user-agent') || '').slice(0, 300));
  return { token, expires };
}

export function destroySession(token) {
  if (token) getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function cookieOptions(expires) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    ...(expires ? { expires: new Date(expires) } : {}),
  };
}

// ---------- Permisos ----------
export function permissionsFor(user) {
  const db = getDb();
  const set = new Set(db.prepare('SELECT permission FROM role_permissions WHERE role = ?').pluck().all(user.role));
  for (const p of db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').pluck().all(user.id)) set.add(p);
  if (user.role === 'superadmin') PERMISOS_BLOQUEADOS_SUPERADMIN.forEach((p) => set.add(p));
  return set;
}

export function loadUser(id) {
  return getDb().prepare(`
    SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.position, u.department_id,
           u.role, u.active, u.must_change_password, d.name AS department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`).get(id);
}

/** Middleware: adjunta req.user si la cookie de sesión es válida. */
export function sessionMiddleware(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const db = getDb();
    const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token));
    if (s && s.expires_at > now()) {
      const user = loadUser(s.user_id);
      if (user && user.active) {
        user.permissions = permissionsFor(user);
        req.user = user;
        req.sessionToken = token;
      }
    } else if (s) {
      destroySession(token);
    }
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Su sesión expiró. Inicie sesión nuevamente.'));
  next();
}

export const can = (user, perm) => !!user?.permissions?.has(perm);

export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Su sesión expiró. Inicie sesión nuevamente.'));
    if (!perms.some((p) => can(req.user, p))) return next(forbidden());
    next();
  };
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: `${user.first_name} ${user.last_name}`,
    position: user.position,
    department_id: user.department_id,
    department_name: user.department_name,
    role: user.role,
    must_change_password: !!user.must_change_password,
    permissions: [...(user.permissions || [])].sort(),
  };
}

// ---------- Limitador de intentos de inicio de sesión ----------
const attempts = new Map();
const WINDOW = 15 * 60_000;
const MAX = 5;

export function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.count >= MAX;
}
export function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
export const loginSucceeded = (key) => attempts.delete(key);
