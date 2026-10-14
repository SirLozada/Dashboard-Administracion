import fs from 'node:fs';
import { Router } from 'express';
import { z } from 'zod';
import { getDb, now } from '../../lib/db.js';
import {
  COOKIE, can, cookieOptions, createSession, destroySession, destroyUserSessions, hashPassword, loadUser,
  loginBlocked, loginFailed, loginSucceeded, permissionsFor, publicUser, requireAuth, requirePerm, sha256,
  validatePasswordStrength, verifyPassword,
} from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../../lib/errors.js';
import { FINANCE_KINDS, discardUpload, filePath, storeUpload, uploadSingle } from '../../lib/files.js';
import { addStream } from '../../lib/notify.js';
import { DEFAULT_SETTINGS, getCurrencies, getSettings } from '../../lib/settings.js';
import { txn } from '../../lib/txn.js';
import { bool, id, optId, reqText, text } from '../../lib/validate.js';
import { PERMISOS, PERMISOS_BLOQUEADOS_SUPERADMIN, ROLES } from '../../../shared/constants.js';
import { canView } from '../requisiciones/service.js';

const router = Router();

// ===========================================================================
// Autenticación
// ===========================================================================

router.post('/auth/login', (req, res) => {
  const { usuario, password } = parse(z.object({
    usuario: reqText('El usuario o correo', 1, 120),
    password: z.string().min(1, 'La contraseña es obligatoria.').max(200),
  }), req.body);
  const key = `${req.ip}|${usuario.toLowerCase()}`;
  if (loginBlocked(key)) throw new HttpError(429, 'Demasiados intentos fallidos. Espere 15 minutos e intente de nuevo.');

  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(usuario, usuario);
  if (!row || !verifyPassword(password, row.password_hash)) {
    loginFailed(key);
    if (row) audit(req, 'login_fallido', 'usuario', row.id, null, row.id);
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  if (!row.active) throw new HttpError(403, 'Su usuario está inactivo. Contacte al administrador del sistema.');
  loginSucceeded(key);
  const { token, expires } = createSession(row.id, req);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), row.id);
  audit(req, 'login', 'usuario', row.id, null, row.id);
  const user = loadUser(row.id);
  user.permissions = permissionsFor(user);
  res.cookie(COOKIE, token, cookieOptions(expires)).json({ user: publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  destroySession(req.sessionToken);
  res.clearCookie(COOKIE, cookieOptions()).json({ ok: true });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const s = getSettings();
  res.json({
    user: publicUser(req.user),
    config: { empresa: s.empresa_nombre, monedas: getCurrencies(), moneda_principal: s.moneda_principal, max_archivo_mb: Number(s.max_archivo_mb) },
  });
});

router.post('/auth/cambiar-clave', requireAuth, (req, res) => {
  const body = parse(z.object({ actual: z.string().min(1, 'Indique su contraseña actual.'), nueva: z.string().max(200) }), req.body);
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(body.actual, row.password_hash)) throw badRequest('La contraseña actual no es correcta.');
  const weak = validatePasswordStrength(body.nueva);
  if (weak) throw badRequest(weak);
  if (body.actual === body.nueva) throw badRequest('La nueva contraseña debe ser diferente a la actual.');
  getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hashPassword(body.nueva), now(), req.user.id);
  // Cierra las demás sesiones abiertas del usuario.
  getDb().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(req.user.id, sha256(req.sessionToken));
  audit(req, 'cambiar_clave', 'usuario', req.user.id);
  res.json({ ok: true });
});

// ===========================================================================
// Notificaciones
// ===========================================================================

router.get('/notificaciones', requireAuth, (req, res) => {
  const q = parse(z.object({ no_leidas: bool.optional(), limite: z.coerce.number().int().min(1).max(200).default(30) }), req.query);
  const db = getDb();
  const items = db.prepare(`SELECT * FROM notifications WHERE user_id = ? ${q.no_leidas ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`).all(req.user.id, q.limite);
  const unread = db.prepare('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL').pluck().get(req.user.id);
  res.json({ items, no_leidas: unread });
});

router.post('/notificaciones/:id/leer', requireAuth, (req, res) => {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(now(), parse(id, req.params.id), req.user.id);
  res.json({ ok: true });
});

router.post('/notificaciones/leer-todas', requireAuth, (req, res) => {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), req.user.id);
  res.json({ ok: true });
});

// Canal de eventos en tiempo real (Server-Sent Events).
router.get('/eventos', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const remove = addStream(req.user.id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => { clearInterval(ping); remove(); });
});

// ===========================================================================
// Archivos protegidos
// ===========================================================================

router.post('/archivos', requireAuth, requirePerm('req.crear'), uploadSingle(), (req, res) => {
  try {
    const f = txn(() => storeUpload(req.file, { kind: 'referencia', userId: req.user.id }));
    res.status(201).json({ ...f, url: `/api/archivos/${f.uuid}` });
  } catch (e) { discardUpload(req.file); throw e; }
});

router.get('/archivos/:uuid', requireAuth, (req, res) => {
  const uuid = parse(z.string().uuid(), req.params.uuid);
  const db = getDb();
  const f = db.prepare('SELECT * FROM files WHERE uuid = ?').get(uuid);
  if (!f) throw notFound('Archivo no encontrado.');
  const user = req.user;
  if (f.requisition_id) {
    const r = db.prepare('SELECT * FROM requisitions WHERE id = ?').get(f.requisition_id);
    if (!r || !canView(user, r)) throw notFound('Archivo no encontrado.');
  } else if (f.uploaded_by !== user.id) {
    throw notFound('Archivo no encontrado.');
  }
  if (FINANCE_KINDS.has(f.kind) && !can(user, 'req.ver_finanzas')) throw forbidden('No tiene acceso a documentos financieros.');
  const p = filePath(f.stored_name);
  if (!fs.existsSync(p)) throw notFound('El archivo no está disponible en el servidor.');
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': `${req.query.descargar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf",
  });
  res.sendFile(p);
});

// ===========================================================================
// Datos maestros de solo lectura (formulario, filtros)
// ===========================================================================

router.get('/catalogo', requireAuth, (_req, res) => {
  const db = getDb();
  res.json({
    categorias: db.prepare('SELECT id, name, description FROM categories WHERE active = 1 ORDER BY name').all(),
    unidades: db.prepare('SELECT id, name, abbreviation FROM units WHERE active = 1 ORDER BY name').all(),
    articulos: db.prepare(`SELECT a.id, a.code, a.name, a.category_id, a.unit_id, a.description, c.name AS category_name
      FROM articles a JOIN categories c ON c.id = a.category_id WHERE a.active = 1 AND c.active = 1 ORDER BY a.name`).all(),
  });
});

router.get('/departamentos', requireAuth, (_req, res) => {
  res.json(getDb().prepare('SELECT id, name, code, active FROM departments ORDER BY name').all());
});

// ===========================================================================
// Proveedores
// ===========================================================================

const supplierSchema = z.object({
  name: reqText('El nombre del proveedor', 2, 200),
  tax_id: text(30),
  contact_name: text(120),
  phone: text(60),
  email: z.preprocess((v) => (v ?? ''), z.string().trim().max(120).refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Correo inválido.')),
  address: text(300),
  active: bool.default(true),
});

router.get('/proveedores', requireAuth, requirePerm('proveedores.gestionar', 'req.revisar', 'pagos.gestionar'), (req, res) => {
  const all = req.query.todos === '1';
  res.json(getDb().prepare(`SELECT * FROM suppliers ${all ? '' : 'WHERE active = 1'} ORDER BY name`).all());
});

router.post('/proveedores', requireAuth, requirePerm('proveedores.gestionar'), (req, res) => {
  const body = parse(supplierSchema, req.body);
  const row = txn(() => {
    const db = getDb();
    if (db.prepare('SELECT 1 FROM suppliers WHERE name = ?').get(body.name)) throw conflict('Ya existe un proveedor con ese nombre.');
    const info = db.prepare(`INSERT INTO suppliers (name, tax_id, contact_name, phone, email, address, active, created_at, updated_at)
      VALUES (@name, @tax_id, @contact_name, @phone, @email, @address, @active, @ts, @ts)`).run({ ...body, active: body.active ? 1 : 0, ts: now() });
    audit(req, 'crear', 'proveedor', Number(info.lastInsertRowid), { name: body.name });
    return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid);
  });
  res.status(201).json(row);
});

router.put('/proveedores/:id', requireAuth, requirePerm('proveedores.gestionar'), (req, res) => {
  const sid = parse(id, req.params.id);
  const body = parse(supplierSchema, req.body);
  const row = txn(() => {
    const db = getDb();
    if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(sid)) throw notFound();
    if (db.prepare('SELECT 1 FROM suppliers WHERE name = ? AND id != ?').get(body.name, sid)) throw conflict('Ya existe un proveedor con ese nombre.');
    db.prepare(`UPDATE suppliers SET name=@name, tax_id=@tax_id, contact_name=@contact_name, phone=@phone, email=@email,
      address=@address, active=@active, updated_at=@ts WHERE id=@id`).run({ ...body, active: body.active ? 1 : 0, ts: now(), id: sid });
    audit(req, 'editar', 'proveedor', sid, body);
    return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(sid);
  });
  res.json(row);
});

// ===========================================================================
// Administración del sistema (Superadministrador)
// ===========================================================================

const admin = Router();
admin.use(requireAuth);

// ---------- Usuarios ----------
const userSchema = z.object({
  username: z.preprocess((v) => (v ?? ''), z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/, 'El usuario debe tener 3 a 40 caracteres (letras, números, punto, guion).')),
  email: z.preprocess((v) => (v ?? ''), z.string().trim().toLowerCase().email('Correo electrónico inválido.')),
  first_name: reqText('El nombre', 1, 80),
  last_name: reqText('El apellido', 1, 80),
  position: text(120),
  department_id: optId,
  role: z.enum(Object.keys(ROLES), { error: 'Seleccione un rol válido.' }),
  active: bool.default(true),
  password: z.string().max(200).optional(),
  permisos_extra: z.array(z.enum(Object.keys(PERMISOS))).default([]),
}).superRefine((v, ctx) => {
  if (v.role !== 'superadmin' && !v.department_id) ctx.addIssue({ code: 'custom', message: 'Seleccione el departamento.', path: ['department_id'] });
});

function userRow(uid) {
  const db = getDb();
  const u = db.prepare(`SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.position, u.department_id, d.name AS department_name,
    u.role, u.active, u.must_change_password, u.last_login_at, u.created_at FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`).get(uid);
  if (u) u.permisos_extra = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').pluck().all(uid);
  return u;
}

admin.get('/usuarios', requirePerm('admin.usuarios'), (_req, res) => {
  const ids = getDb().prepare('SELECT id FROM users ORDER BY active DESC, first_name, last_name').pluck().all();
  res.json(ids.map(userRow));
});

function saveUser(req, uid) {
  const body = parse(userSchema, req.body);
  const db = getDb();
  if (body.department_id && !db.prepare('SELECT 1 FROM departments WHERE id = ?').get(body.department_id)) throw badRequest('Departamento inválido.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ? AND id != ?').get(body.username, uid ?? -1)) throw conflict('El nombre de usuario ya está en uso.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(body.email, uid ?? -1)) throw conflict('El correo electrónico ya está registrado.');
  if (body.password || !uid) {
    const weak = validatePasswordStrength(body.password || '');
    if (weak) throw badRequest(weak);
  }
  return txn(() => {
    const ts = now();
    const params = { ...body, active: body.active ? 1 : 0, department_id: body.department_id ?? null, ts };
    if (uid) {
      const prev = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
      if (!prev) throw notFound('Usuario no encontrado.');
      if (uid === req.user.id && (!body.active || body.role !== prev.role)) throw badRequest('No puede desactivar ni cambiar el rol de su propio usuario.');
      db.prepare(`UPDATE users SET username=@username, email=@email, first_name=@first_name, last_name=@last_name, position=@position,
        department_id=@department_id, role=@role, active=@active, updated_at=@ts WHERE id=@id`).run({ ...params, id: uid });
      if (body.password) db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(body.password), uid);
      if (!body.active || body.password || prev.role !== body.role) destroyUserSessions(uid);
      audit(req, 'editar', 'usuario', uid, {
        username: body.username, role: body.role, active: body.active, ...(body.password ? { clave: 'restablecida' } : {}),
        ...(prev.active && !body.active ? { estado: 'desactivado' } : {}),
      });
    } else {
      const info = db.prepare(`INSERT INTO users (username, email, first_name, last_name, position, department_id, role, active,
        password_hash, must_change_password, created_at, updated_at) VALUES (@username, @email, @first_name, @last_name, @position,
        @department_id, @role, @active, @hash, 1, @ts, @ts)`).run({ ...params, hash: hashPassword(body.password) });
      uid = Number(info.lastInsertRowid);
      audit(req, 'crear', 'usuario', uid, { username: body.username, role: body.role });
    }
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(uid);
    const ins = db.prepare('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)');
    for (const p of new Set(body.permisos_extra)) ins.run(uid, p);
    return userRow(uid);
  });
}

admin.post('/usuarios', requirePerm('admin.usuarios'), (req, res) => res.status(201).json(saveUser(req)));
admin.put('/usuarios/:id', requirePerm('admin.usuarios'), (req, res) => res.json(saveUser(req, parse(id, req.params.id))));

// ---------- Departamentos ----------
const deptSchema = z.object({
  name: reqText('El nombre', 2, 120),
  code: z.preprocess((v) => (v ?? ''), z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,10}$/, 'El código debe tener 2 a 10 caracteres (letras, números o guion).')),
  active: bool.default(true),
});

admin.get('/departamentos', requirePerm('admin.departamentos', 'admin.usuarios'), (_req, res) => {
  res.json(getDb().prepare(`SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.active = 1) AS usuarios,
    (SELECT COUNT(*) FROM requisitions r WHERE r.department_id = d.id) AS requisiciones FROM departments d ORDER BY d.name`).all());
});

function crud(table, entity, schema, perm, { unique = ['name'], map = (b) => b } = {}) {
  const cols = Object.keys(schema.shape);
  admin.post(`/${entity}`, requirePerm(perm), (req, res) => {
    const body = map(parse(schema, req.body));
    const row = txn(() => {
      const db = getDb();
      for (const u of unique) if (body[u] && db.prepare(`SELECT 1 FROM ${table} WHERE ${u} = ?`).get(body[u])) throw conflict(`Ya existe un registro con ese ${u === 'code' ? 'código' : 'nombre'}.`);
      const ts = now();
      const info = db.prepare(`INSERT INTO ${table} (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map((c) => `@${c}`).join(',')}, @ts, @ts)`)
        .run({ ...body, active: body.active ? 1 : 0, ts });
      audit(req, 'crear', entity, Number(info.lastInsertRowid), body);
      return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(info.lastInsertRowid);
    });
    res.status(201).json(row);
  });
  admin.put(`/${entity}/:id`, requirePerm(perm), (req, res) => {
    const rid = parse(id, req.params.id);
    const body = map(parse(schema, req.body));
    const row = txn(() => {
      const db = getDb();
      if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(rid)) throw notFound();
      for (const u of unique) if (body[u] && db.prepare(`SELECT 1 FROM ${table} WHERE ${u} = ? AND id != ?`).get(body[u], rid)) throw conflict(`Ya existe un registro con ese ${u === 'code' ? 'código' : 'nombre'}.`);
      db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @ts WHERE id = @id`)
        .run({ ...body, active: body.active ? 1 : 0, ts: now(), id: rid });
      audit(req, 'editar', entity, rid, body);
      return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rid);
    });
    res.json(row);
  });
}

crud('departments', 'departamentos', deptSchema, 'admin.departamentos', { unique: ['name', 'code'] });

// ---------- Catálogo ----------
crud('categories', 'categorias', z.object({ name: reqText('El nombre', 2, 120), description: text(500), active: bool.default(true) }), 'admin.catalogo');
crud('units', 'unidades', z.object({ name: reqText('El nombre', 1, 60), abbreviation: reqText('La abreviatura', 1, 15), active: bool.default(true) }), 'admin.catalogo');
crud('articles', 'articulos', z.object({
  code: z.preprocess((v) => (v === '' || v == null ? null : v), z.string().trim().toUpperCase().max(40).nullable()),
  name: reqText('El nombre', 2, 200),
  category_id: z.coerce.number({ error: 'Seleccione la categoría.' }).int().positive('Seleccione la categoría.'),
  unit_id: optId,
  description: text(1000),
  active: bool.default(true),
}), 'admin.catalogo', { unique: ['code'] });

admin.get('/catalogo', requirePerm('admin.catalogo'), (_req, res) => {
  const db = getDb();
  res.json({
    categorias: db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS articulos FROM categories c ORDER BY c.name`).all(),
    unidades: db.prepare('SELECT * FROM units ORDER BY name').all(),
    articulos: db.prepare(`SELECT a.*, c.name AS category_name, u.name AS unit_name,
      (SELECT COUNT(*) FROM requisition_items ri WHERE ri.article_id = a.id) AS usos
      FROM articles a JOIN categories c ON c.id = a.category_id LEFT JOIN units u ON u.id = a.unit_id ORDER BY a.name`).all(),
  });
});

// ---------- Permisos por rol ----------
admin.get('/permisos', requirePerm('admin.permisos'), (_req, res) => {
  const rows = getDb().prepare('SELECT role, permission FROM role_permissions').all();
  const matrix = Object.fromEntries(Object.keys(ROLES).map((r) => [r, rows.filter((x) => x.role === r).map((x) => x.permission)]));
  res.json({ roles: ROLES, permisos: PERMISOS, matriz: matrix, bloqueados: { superadmin: PERMISOS_BLOQUEADOS_SUPERADMIN } });
});

admin.put('/permisos/:role', requirePerm('admin.permisos'), (req, res) => {
  const role = parse(z.enum(Object.keys(ROLES)), req.params.role);
  const { permisos } = parse(z.object({ permisos: z.array(z.enum(Object.keys(PERMISOS))) }), req.body);
  const set = new Set(permisos);
  if (role === 'superadmin') PERMISOS_BLOQUEADOS_SUPERADMIN.forEach((p) => set.add(p));
  txn(() => {
    const db = getDb();
    const before = db.prepare('SELECT permission FROM role_permissions WHERE role = ?').pluck().all(role);
    db.prepare('DELETE FROM role_permissions WHERE role = ?').run(role);
    const ins = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
    for (const p of set) ins.run(role, p);
    audit(req, 'editar', 'permisos', null, {
      role, agregados: [...set].filter((p) => !before.includes(p)), retirados: before.filter((p) => !set.has(p)),
    });
  });
  res.json({ ok: true });
});

// ---------- Auditoría ----------
admin.get('/auditoria', requirePerm('admin.auditoria'), (req, res) => {
  const q = parse(z.object({
    usuario: optId.optional(), entidad: z.string().max(40).optional(), accion: z.string().max(40).optional(),
    desde: z.string().max(10).optional(), hasta: z.string().max(10).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
  }), req.query);
  const where = ['1=1'];
  const params = {};
  if (q.usuario) { where.push('a.user_id = @u'); params.u = q.usuario; }
  if (q.entidad) { where.push('a.entity = @e'); params.e = q.entidad; }
  if (q.accion) { where.push('a.action = @a'); params.a = q.accion; }
  if (q.desde) { where.push('substr(a.created_at,1,10) >= @d'); params.d = q.desde; }
  if (q.hasta) { where.push('substr(a.created_at,1,10) <= @h'); params.h = q.hasta; }
  const db = getDb();
  const total = db.prepare(`SELECT COUNT(*) FROM audit_log a WHERE ${where.join(' AND ')}`).pluck().get(params);
  const items = db.prepare(`SELECT a.*, u.first_name || ' ' || u.last_name AS user_name, u.username FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 50 OFFSET @off`)
    .all({ ...params, off: (q.pagina - 1) * 50 });
  res.json({
    total, pagina: q.pagina, por_pagina: 50, items,
    entidades: db.prepare('SELECT DISTINCT entity FROM audit_log ORDER BY entity').pluck().all(),
    acciones: db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').pluck().all(),
  });
});

// ---------- Parámetros generales ----------
const settingsSchema = z.object({
  empresa_nombre: reqText('El nombre de la empresa', 2, 120),
  req_prefijo: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, 'El prefijo debe tener de 2 a 6 letras.'),
  moneda_principal: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Moneda principal inválida.'),
  monedas: z.string().trim().toUpperCase().regex(/^[A-Z]{3}(\s*,\s*[A-Z]{3})*$/, 'Indique monedas ISO separadas por coma (ej. USD,VES).'),
  dias_credito: z.coerce.number().int().min(0).max(365),
  tolerancia_sobrecosto_pct: z.coerce.number().min(0).max(100),
  max_archivo_mb: z.coerce.number().int().min(1).max(50),
  sesion_horas: z.coerce.number().int().min(1).max(72),
}).superRefine((v, ctx) => {
  if (!v.monedas.split(',').map((s) => s.trim()).includes(v.moneda_principal)) {
    ctx.addIssue({ code: 'custom', message: 'La moneda principal debe estar entre las monedas habilitadas.', path: ['moneda_principal'] });
  }
});

admin.get('/parametros', requirePerm('admin.parametros'), (_req, res) => res.json(getSettings()));

admin.put('/parametros', requirePerm('admin.parametros'), (req, res) => {
  const body = parse(settingsSchema, req.body);
  txn(() => {
    const db = getDb();
    const before = getSettings();
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const changes = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const v = String(body[k]).replace(/\s+/g, k === 'empresa_nombre' ? ' ' : '');
      up.run(k, v);
      if (before[k] !== v) changes[k] = { antes: before[k], despues: v };
    }
    audit(req, 'editar', 'parametros', null, changes);
  });
  res.json(getSettings());
});

router.use('/admin', admin);

export default router;
