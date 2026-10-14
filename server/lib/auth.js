import crypto from 'node:crypto';
import { db, now } from './db.js';
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

export async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hours = Number(await getSetting('sesion_horas')) || 12;
  const expires = new Date(Date.now() + hours * 3600_000).toISOString();
  await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    [sha256(token), userId, now(), expires, req.ip, String(req.get('user-agent') || '').slice(0, 300)]);
  return { token, expires };
}

export async function destroySession(token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

export async function destroyUserSessions(userId) {
  await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export function cookieOptions(expires) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true' || !!process.env.VERCEL,
    path: '/',
    ...(expires ? { expires: new Date(expires) } : {}),
  };
}

// ---------- Permisos ----------
export async function permissionsFor(user) {
  const set = new Set(await db.column('SELECT permission FROM role_permissions WHERE role = ?', [user.role]));
  for (const p of await db.column('SELECT permission FROM user_permissions WHERE user_id = ?', [user.id])) set.add(p);
  if (user.role === 'superadmin') PERMISOS_BLOQUEADOS_SUPERADMIN.forEach((p) => set.add(p));
  return set;
}

export function loadUser(id) {
  return db.get(`
    SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.position, u.department_id,
           u.role, u.active, u.must_change_password, d.name AS department_name
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, [id]);
}

/** Middleware: adjunta req.user si la cookie de sesión es válida. */
export async function sessionMiddleware(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const s = await db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', [sha256(token)]);
    if (s && s.expires_at > now()) {
      const user = await loadUser(s.user_id);
      if (user && user.active) {
        user.permissions = await permissionsFor(user);
        req.user = user;
        req.sessionToken = token;
      }
    } else if (s) {
      await destroySession(token);
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

// ---------- Limitador de intentos de inicio de sesión (en BD: válido con varias instancias) ----------
const WINDOW = 15 * 60_000;
const MAX = 5;

export async function loginBlocked(key) {
  const a = await db.get('SELECT count, first_at FROM login_attempts WHERE key = ?', [key]);
  if (!a) return false;
  if (Date.now() - a.first_at > WINDOW) { await db.run('DELETE FROM login_attempts WHERE key = ?', [key]); return false; }
  return a.count >= MAX;
}
export async function loginFailed(key) {
  await db.run(`INSERT INTO login_attempts (key, count, first_at) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET count = CASE WHEN ? - login_attempts.first_at > ? THEN 1 ELSE login_attempts.count + 1 END,
    first_at = CASE WHEN ? - login_attempts.first_at > ? THEN EXCLUDED.first_at ELSE login_attempts.first_at END`,
  [key, Date.now(), Date.now(), WINDOW, Date.now(), WINDOW]);
}
export const loginSucceeded = (key) => db.run('DELETE FROM login_attempts WHERE key = ?', [key]);
