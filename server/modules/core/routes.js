import { Router } from 'express';
import { z } from 'zod';
import { db, now } from '../../lib/db.js';
import {
  COOKIE, can, cookieOptions, createSession, destroySession, destroyUserSessions, hashPassword, loadUser,
  loginBlocked, loginFailed, loginSucceeded, permissionsFor, publicUser, requireAuth, requirePerm, sha256,
  validatePasswordStrength, verifyPassword,
} from '../../lib/auth.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../../lib/errors.js';
import { FINANCE_KINDS, discardUpload, openStored, storeUpload, uploadSingle } from '../../lib/files.js';
import { REALTIME, addStream } from '../../lib/notify.js';
import { DEFAULT_SETTINGS, getCurrencies, getSettings, maxUploadMb } from '../../lib/settings.js';
import { txn } from '../../lib/txn.js';
import { bool, id, optId, reqText, text } from '../../lib/validate.js';
import { PERMISOS, PERMISOS_BLOQUEADOS_SUPERADMIN, ROLES } from '../../../shared/constants.js';
import { canView } from '../requisiciones/service.js';

const router = Router();

// ===========================================================================
// Autenticación
// ===========================================================================

router.post('/auth/login', async (req, res) => {
  const { usuario, password } = parse(z.object({
    usuario: reqText('El usuario o correo', 1, 120),
    password: z.string().min(1, 'La contraseña es obligatoria.').max(200),
  }), req.body);
  const key = `${req.ip}|${usuario.toLowerCase()}`;
  if (await loginBlocked(key)) throw new HttpError(429, 'Demasiados intentos fallidos. Espere 15 minutos e intente de nuevo.');

    const row = await db.get('SELECT * FROM users WHERE username = ? OR email = ?', [usuario, usuario]);
  if (!row || !verifyPassword(password, row.password_hash)) {
    await loginFailed(key);
    if (row) await audit(req, 'login_fallido', 'usuario', row.id, null, row.id);
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  if (!row.active) throw new HttpError(403, 'Su usuario está inactivo. Contacte al administrador del sistema.');
  await loginSucceeded(key);
  const { token, expires } = await createSession(row.id, req);
  await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), row.id]);
  await audit(req, 'login', 'usuario', row.id, null, row.id);
  const user = await loadUser(row.id);
  user.permissions = await permissionsFor(user);
  res.cookie(COOKIE, token, cookieOptions(expires)).json({ user: publicUser(user) });
});

router.post('/auth/logout', async (req, res) => {
  await destroySession(req.sessionToken);
  res.clearCookie(COOKIE, cookieOptions()).json({ ok: true });
});

router.get('/auth/me', requireAuth, async (req, res) => {
  const s = await getSettings();
  res.json({
    user: publicUser(req.user),
    config: { empresa: s.empresa_nombre, monedas: await getCurrencies(), moneda_principal: s.moneda_principal, max_archivo_mb: await maxUploadMb(), tiempo_real: REALTIME },
  });
});

router.post('/auth/cambiar-clave', requireAuth, async (req, res) => {
  const body = parse(z.object({ actual: z.string().min(1, 'Indique su contraseña actual.'), nueva: z.string().max(200) }), req.body);
  const row = await db.get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(body.actual, row.password_hash)) throw badRequest('La contraseña actual no es correcta.');
  const weak = validatePasswordStrength(body.nueva);
  if (weak) throw badRequest(weak);
  if (body.actual === body.nueva) throw badRequest('La nueva contraseña debe ser diferente a la actual.');
  await db.run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [hashPassword(body.nueva), now(), req.user.id]);
  // Cierra las demás sesiones abiertas del usuario.
  await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', [req.user.id, sha256(req.sessionToken)]);
  await audit(req, 'cambiar_clave', 'usuario', req.user.id);
  res.json({ ok: true });
});

// ===========================================================================
// Notificaciones
// ===========================================================================

router.get('/notificaciones', requireAuth, async (req, res) => {
  const q = parse(z.object({ no_leidas: bool.optional(), limite: z.coerce.number().int().min(1).max(200).default(30) }), req.query);
    const items = await db.all(`SELECT * FROM notifications WHERE user_id = ? ${q.no_leidas ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT ?`, [req.user.id, q.limite]);
  const unread = await db.value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
  res.json({ items, no_leidas: unread });
});

router.post('/notificaciones/:id/leer', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', [now(), parse(id, req.params.id), req.user.id]);
  res.json({ ok: true });
});

router.post('/notificaciones/leer-todas', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [now(), req.user.id]);
  res.json({ ok: true });
});

// Canal de eventos en tiempo real (Server-Sent Events).
router.get('/eventos', requireAuth, async (req, res) => {
  // Sin servidor persistente (Vercel) el cliente usa consultas periódicas.
  if (!REALTIME) return res.status(204).end();
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

router.post('/archivos', requireAuth, requirePerm('req.crear'), uploadSingle(), async (req, res) => {
  try {
    const f = await txn(async () => await storeUpload(req.file, { kind: 'referencia', userId: req.user.id }));
    res.status(201).json({ ...f, url: `/api/archivos/${f.uuid}` });
  } catch (e) { discardUpload(req.file); throw e; }
});

router.get('/archivos/:uuid', requireAuth, async (req, res) => {
  const uuid = parse(z.string().uuid(), req.params.uuid);
    const f = await db.get('SELECT * FROM files WHERE uuid = ?', [uuid]);
  if (!f) throw notFound('Archivo no encontrado.');
  const user = req.user;
  if (f.requisition_id) {
    const r = await db.get('SELECT * FROM requisitions WHERE id = ?', [f.requisition_id]);
    if (!r || !canView(user, r)) throw notFound('Archivo no encontrado.');
  } else if (f.uploaded_by !== user.id) {
    throw notFound('Archivo no encontrado.');
  }
  if (FINANCE_KINDS.has(f.kind) && !can(user, 'req.ver_finanzas')) throw forbidden('No tiene acceso a documentos financieros.');
  const stream = await openStored(f.stored_name);
  if (!stream) throw notFound('El archivo no está disponible en el servidor.');
  res.set({
    'Content-Type': f.mime,
    'Content-Disposition': `${req.query.descargar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf",
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

// ===========================================================================
// Datos maestros de solo lectura (formulario, filtros)
// ===========================================================================

router.get('/catalogo', requireAuth, async (_req, res) => {
    res.json({
    categorias: await db.all('SELECT id, name, description FROM categories WHERE active = 1 ORDER BY name'),
    unidades: await db.all('SELECT id, name, abbreviation FROM units WHERE active = 1 ORDER BY name'),
    articulos: await db.all(`SELECT a.id, a.code, a.name, a.category_id, a.unit_id, a.description, c.name AS category_name
      FROM articles a JOIN categories c ON c.id = a.category_id WHERE a.active = 1 AND c.active = 1 ORDER BY a.name`),
  });
});

router.get('/departamentos', requireAuth, async (_req, res) => {
  res.json(await db.all('SELECT id, name, code, active FROM departments ORDER BY name'));
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

router.get('/proveedores', requireAuth, requirePerm('proveedores.gestionar', 'req.revisar', 'pagos.gestionar'), async (req, res) => {
  const all = req.query.todos === '1';
  res.json(await db.all(`SELECT * FROM suppliers ${all ? '' : 'WHERE active = 1'} ORDER BY name`));
});

router.post('/proveedores', requireAuth, requirePerm('proveedores.gestionar'), async (req, res) => {
  const body = parse(supplierSchema, req.body);
  const row = await txn(async () => {
        if (await db.get('SELECT 1 FROM suppliers WHERE name = ?', [body.name])) throw conflict('Ya existe un proveedor con ese nombre.');
    const info = await db.run(`INSERT INTO suppliers (name, tax_id, contact_name, phone, email, address, active, created_at, updated_at)
      VALUES (@name, @tax_id, @contact_name, @phone, @email, @address, @active, @ts, @ts) RETURNING id`, { ...body, active: body.active ? 1 : 0, ts: now() });
    await audit(req, 'crear', 'proveedor', info.id, { name: body.name });
    return await db.get('SELECT * FROM suppliers WHERE id = ?', [info.id]);
  });
  res.status(201).json(row);
});

router.put('/proveedores/:id', requireAuth, requirePerm('proveedores.gestionar'), async (req, res) => {
  const sid = parse(id, req.params.id);
  const body = parse(supplierSchema, req.body);
  const row = await txn(async () => {
        if (!await db.get('SELECT 1 FROM suppliers WHERE id = ?', [sid])) throw notFound();
    if (await db.get('SELECT 1 FROM suppliers WHERE name = ? AND id != ?', [body.name, sid])) throw conflict('Ya existe un proveedor con ese nombre.');
    await db.run(`UPDATE suppliers SET name=@name, tax_id=@tax_id, contact_name=@contact_name, phone=@phone, email=@email,
      address=@address, active=@active, updated_at=@ts WHERE id=@id`, { ...body, active: body.active ? 1 : 0, ts: now(), id: sid });
    await audit(req, 'editar', 'proveedor', sid, body);
    return await db.get('SELECT * FROM suppliers WHERE id = ?', [sid]);
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

async function userRow(uid) {
    const u = await db.get(`SELECT u.id, u.username, u.email, u.first_name, u.last_name, u.position, u.department_id, d.name AS department_name,
    u.role, u.active, u.must_change_password, u.last_login_at, u.created_at FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, [uid]);
  if (u) u.permisos_extra = await db.column('SELECT permission FROM user_permissions WHERE user_id = ?', [uid]);
  return u;
}

admin.get('/usuarios', requirePerm('admin.usuarios'), async (_req, res) => {
  const ids = await db.column('SELECT id FROM users ORDER BY active DESC, first_name, last_name');
  res.json(await Promise.all(ids.map(userRow)));
});

async function saveUser(req, uid) {
  const body = parse(userSchema, req.body);
    if (body.department_id && !await db.get('SELECT 1 FROM departments WHERE id = ?', [body.department_id])) throw badRequest('Departamento inválido.');
  if (await db.get('SELECT 1 FROM users WHERE username = ? AND id != ?', [body.username, uid ?? -1])) throw conflict('El nombre de usuario ya está en uso.');
  if (await db.get('SELECT 1 FROM users WHERE email = ? AND id != ?', [body.email, uid ?? -1])) throw conflict('El correo electrónico ya está registrado.');
  if (body.password || !uid) {
    const weak = validatePasswordStrength(body.password || '');
    if (weak) throw badRequest(weak);
  }
  return await txn(async () => {
    const ts = now();
    const params = { ...body, active: body.active ? 1 : 0, department_id: body.department_id ?? null, ts };
    if (uid) {
      const prev = await db.get('SELECT * FROM users WHERE id = ?', [uid]);
      if (!prev) throw notFound('Usuario no encontrado.');
      if (uid === req.user.id && (!body.active || body.role !== prev.role)) throw badRequest('No puede desactivar ni cambiar el rol de su propio usuario.');
      await db.run(`UPDATE users SET username=@username, email=@email, first_name=@first_name, last_name=@last_name, position=@position,
        department_id=@department_id, role=@role, active=@active, updated_at=@ts WHERE id=@id`, { ...params, id: uid });
      if (body.password) await db.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?', [hashPassword(body.password), uid]);
      if (!body.active || body.password || prev.role !== body.role) await destroyUserSessions(uid);
      await audit(req, 'editar', 'usuario', uid, {
        username: body.username, role: body.role, active: body.active, ...(body.password ? { clave: 'restablecida' } : {}),
        ...(prev.active && !body.active ? { estado: 'desactivado' } : {}),
      });
    } else {
      const info = await db.run(`INSERT INTO users (username, email, first_name, last_name, position, department_id, role, active,
        password_hash, must_change_password, created_at, updated_at) VALUES (@username, @email, @first_name, @last_name, @position,
        @department_id, @role, @active, @hash, 1, @ts, @ts) RETURNING id`, { ...params, hash: hashPassword(body.password) });
      uid = info.id;
      await audit(req, 'crear', 'usuario', uid, { username: body.username, role: body.role });
    }
    await db.run('DELETE FROM user_permissions WHERE user_id = ?', [uid]);
    const ins = ((...a) => db.run('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)', a.length === 1 && typeof a[0] === "object" && !Array.isArray(a[0]) ? a[0] : a));
    for (const p of new Set(body.permisos_extra)) await ins(uid, p);
    return await userRow(uid);
  });
}

admin.post('/usuarios', requirePerm('admin.usuarios'), async (req, res) => res.status(201).json(await saveUser(req)));
admin.put('/usuarios/:id', requirePerm('admin.usuarios'), async (req, res) => res.json(await saveUser(req, parse(id, req.params.id))));

// ---------- Departamentos ----------
const deptSchema = z.object({
  name: reqText('El nombre', 2, 120),
  code: z.preprocess((v) => (v ?? ''), z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,10}$/, 'El código debe tener 2 a 10 caracteres (letras, números o guion).')),
  active: bool.default(true),
});

admin.get('/departamentos', requirePerm('admin.departamentos', 'admin.usuarios'), async (_req, res) => {
  res.json(await db.all(`SELECT d.*, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.active = 1) AS usuarios,
    (SELECT COUNT(*) FROM requisitions r WHERE r.department_id = d.id) AS requisiciones FROM departments d ORDER BY d.name`));
});

function crud(table, entity, schema, perm, { unique = ['name'], map = (b) => b } = {}) {
  const cols = Object.keys(schema.shape);
  admin.post(`/${entity}`, requirePerm(perm), async (req, res) => {
    const body = map(parse(schema, req.body));
    const row = await txn(async () => {
            for (const u of unique) if (body[u] && await db.get(`SELECT 1 FROM ${table} WHERE ${u} = ?`, [body[u]])) throw conflict(`Ya existe un registro con ese ${u === 'code' ? 'código' : 'nombre'}.`);
      const ts = now();
      const info = await db.run(`INSERT INTO ${table} (${cols.join(',')}, created_at, updated_at) VALUES (${cols.map((c) => `@${c}`).join(',')}, @ts, @ts) RETURNING id`, { ...body, active: body.active ? 1 : 0, ts });
      await audit(req, 'crear', entity, info.id, body);
      return await db.get(`SELECT * FROM ${table} WHERE id = ?`, [info.id]);
    });
    res.status(201).json(row);
  });
  admin.put(`/${entity}/:id`, requirePerm(perm), async (req, res) => {
    const rid = parse(id, req.params.id);
    const body = map(parse(schema, req.body));
    const row = await txn(async () => {
            if (!await db.get(`SELECT 1 FROM ${table} WHERE id = ?`, [rid])) throw notFound();
      for (const u of unique) if (body[u] && await db.get(`SELECT 1 FROM ${table} WHERE ${u} = ? AND id != ?`, [body[u], rid])) throw conflict(`Ya existe un registro con ese ${u === 'code' ? 'código' : 'nombre'}.`);
      await db.run(`UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @ts WHERE id = @id`, { ...body, active: body.active ? 1 : 0, ts: now(), id: rid });
      await audit(req, 'editar', entity, rid, body);
      return await db.get(`SELECT * FROM ${table} WHERE id = ?`, [rid]);
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

admin.get('/catalogo', requirePerm('admin.catalogo'), async (_req, res) => {
    res.json({
    categorias: await db.all(`SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS articulos FROM categories c ORDER BY c.name`),
    unidades: await db.all('SELECT * FROM units ORDER BY name'),
    articulos: await db.all(`SELECT a.*, c.name AS category_name, u.name AS unit_name,
      (SELECT COUNT(*) FROM requisition_items ri WHERE ri.article_id = a.id) AS usos
      FROM articles a JOIN categories c ON c.id = a.category_id LEFT JOIN units u ON u.id = a.unit_id ORDER BY a.name`),
  });
});

// ---------- Permisos por rol ----------
admin.get('/permisos', requirePerm('admin.permisos'), async (_req, res) => {
  const rows = await db.all('SELECT role, permission FROM role_permissions');
  const matrix = Object.fromEntries(Object.keys(ROLES).map((r) => [r, rows.filter((x) => x.role === r).map((x) => x.permission)]));
  res.json({ roles: ROLES, permisos: PERMISOS, matriz: matrix, bloqueados: { superadmin: PERMISOS_BLOQUEADOS_SUPERADMIN } });
});

admin.put('/permisos/:role', requirePerm('admin.permisos'), async (req, res) => {
  const role = parse(z.enum(Object.keys(ROLES)), req.params.role);
  const { permisos } = parse(z.object({ permisos: z.array(z.enum(Object.keys(PERMISOS))) }), req.body);
  const set = new Set(permisos);
  if (role === 'superadmin') PERMISOS_BLOQUEADOS_SUPERADMIN.forEach((p) => set.add(p));
  await txn(async () => {
        const before = await db.column('SELECT permission FROM role_permissions WHERE role = ?', [role]);
    await db.run('DELETE FROM role_permissions WHERE role = ?', [role]);
    const ins = ((...a) => db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', a.length === 1 && typeof a[0] === "object" && !Array.isArray(a[0]) ? a[0] : a));
    for (const p of set) await ins(role, p);
    await audit(req, 'editar', 'permisos', null, {
      role, agregados: [...set].filter((p) => !before.includes(p)), retirados: before.filter((p) => !set.has(p)),
    });
  });
  res.json({ ok: true });
});

// ---------- Auditoría ----------
admin.get('/auditoria', requirePerm('admin.auditoria'), async (req, res) => {
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
    const total = await db.value(`SELECT COUNT(*) FROM audit_log a WHERE ${where.join(' AND ')}`, params);
  const items = await db.all(`SELECT a.*, u.first_name || ' ' || u.last_name AS user_name, u.username FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 50 OFFSET @off`, { ...params, off: (q.pagina - 1) * 50 });
  res.json({
    total, pagina: q.pagina, por_pagina: 50, items,
    entidades: await db.column('SELECT DISTINCT entity FROM audit_log ORDER BY entity'),
    acciones: await db.column('SELECT DISTINCT action FROM audit_log ORDER BY action'),
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

admin.get('/parametros', requirePerm('admin.parametros'), async (_req, res) => res.json(await getSettings()));

admin.put('/parametros', requirePerm('admin.parametros'), async (req, res) => {
  const body = parse(settingsSchema, req.body);
  await txn(async () => {
        const before = await getSettings();
    const up = ((...a) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', a.length === 1 && typeof a[0] === "object" && !Array.isArray(a[0]) ? a[0] : a));
    const changes = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      const v = String(body[k]).replace(/\s+/g, k === 'empresa_nombre' ? ' ' : '');
      await up(k, v);
      if (before[k] !== v) changes[k] = { antes: before[k], despues: v };
    }
    await audit(req, 'editar', 'parametros', null, changes);
  });
  res.json(await getSettings());
});

router.use('/admin', admin);

export default router;
