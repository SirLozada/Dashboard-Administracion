import crypto from 'node:crypto';
import { db, initDb, now, tx } from './lib/db.js';
import { hashPassword } from './lib/auth.js';
import { PERMISOS_POR_DEFECTO } from '../shared/constants.js';

const DEPARTAMENTOS = [
  ['Administración y Finanzas', 'ADM'], ['Compras', 'COM'], ['Producción', 'PRO'], ['Control de Calidad', 'CC'],
  ['Investigación y Desarrollo', 'ID'], ['Mantenimiento', 'MAN'], ['Almacén y Logística', 'ALM'],
  ['Recursos Humanos', 'RRHH'], ['Ventas y Mercadeo', 'VEN'], ['Tecnología', 'TI'], ['Dirección General', 'DIR'],
];

const UNIDADES = [
  ['Unidad', 'und'], ['Caja', 'cja'], ['Paquete', 'paq'], ['Resma', 'rsm'], ['Kilogramo', 'kg'], ['Gramo', 'g'],
  ['Litro', 'L'], ['Mililitro', 'mL'], ['Galón', 'gal'], ['Metro', 'm'], ['Rollo', 'rll'], ['Par', 'par'],
  ['Juego', 'jgo'], ['Bulto', 'blt'], ['Servicio', 'serv'],
];

const CATALOGO = {
  'Papelería y oficina': [['Papel bond carta', 'Resma'], ['Papel bond oficio', 'Resma'], ['Bolígrafos azules', 'Caja'], ['Carpetas manila carta', 'Caja'], ['Tóner para impresora', 'Unidad'], ['Grapas estándar', 'Caja'], ['Marcadores para pizarra', 'Caja'], ['Sobres manila', 'Paquete']],
  'Limpieza e higiene': [['Desinfectante multiuso', 'Galón'], ['Cloro', 'Galón'], ['Papel higiénico institucional', 'Bulto'], ['Jabón líquido para manos', 'Galón'], ['Bolsas para basura', 'Paquete'], ['Toallas de papel', 'Bulto'], ['Alcohol isopropílico 70%', 'Litro']],
  'Insumos de laboratorio': [['Guantes de nitrilo talla M', 'Caja'], ['Tubos de ensayo 15 mL', 'Caja'], ['Pipetas desechables', 'Caja'], ['Papel filtro', 'Caja'], ['Placas de Petri', 'Paquete'], ['Vasos de precipitado 250 mL', 'Unidad']],
  'Reactivos': [['Etanol absoluto', 'Litro'], ['Agua destilada', 'Litro'], ['Ácido cítrico', 'Kilogramo'], ['Hidróxido de sodio', 'Kilogramo']],
  'Materia prima': [['Extracto de manzanilla', 'Kilogramo'], ['Extracto de valeriana', 'Kilogramo'], ['Glicerina USP', 'Litro'], ['Sacarosa', 'Kilogramo'], ['Esencia de menta', 'Litro']],
  'Material de empaque': [['Frasco ámbar 120 mL', 'Unidad'], ['Tapas de seguridad', 'Unidad'], ['Etiquetas autoadhesivas', 'Rollo'], ['Cajas de cartón corrugado', 'Unidad'], ['Cinta de embalaje', 'Rollo']],
  'Seguridad industrial (EPP)': [['Tapabocas desechables', 'Caja'], ['Lentes de seguridad', 'Unidad'], ['Batas de laboratorio', 'Unidad'], ['Botas de seguridad', 'Par'], ['Gorros desechables', 'Paquete']],
  'Repuestos y mantenimiento': [['Bombillos LED', 'Unidad'], ['Filtros de aire acondicionado', 'Unidad'], ['Lubricante industrial', 'Litro'], ['Juego de herramientas', 'Juego']],
  'Tecnología': [['Mouse inalámbrico', 'Unidad'], ['Teclado USB', 'Unidad'], ['Cable de red UTP', 'Metro'], ['Memoria USB 64 GB', 'Unidad']],
  'Servicios': [['Mantenimiento de aires acondicionados', 'Servicio'], ['Calibración de equipos', 'Servicio'], ['Fumigación', 'Servicio']],
};

/** Inicializa los datos mínimos del sistema en el primer arranque. Idempotente. */
export async function bootstrap({ log = console.log } = {}) {
  await initDb();
  const ts = now();
  await tx(async () => {
    // Evita que dos instancias inicialicen a la vez (Vercel puede arrancar varias).
    await db.get('SELECT pg_advisory_xact_lock(724502)');
    if (!await db.value('SELECT COUNT(*) FROM role_permissions')) {
      for (const [role, perms] of Object.entries(PERMISOS_POR_DEFECTO)) {
        for (const p of perms) await db.run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', [role, p]);
      }
    }
    if (!await db.value('SELECT COUNT(*) FROM departments')) {
      for (const [n, c] of DEPARTAMENTOS) {
        await db.run('INSERT INTO departments (name, code, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [n, c, ts, ts]);
      }
    }
    if (!await db.value('SELECT COUNT(*) FROM units')) {
      for (const [n, a] of UNIDADES) {
        await db.run('INSERT INTO units (name, abbreviation, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [n, a, ts, ts]);
      }
    }
    if (!await db.value('SELECT COUNT(*) FROM categories')) {
      let n = 0;
      for (const [cat, arts] of Object.entries(CATALOGO)) {
        const { id: cid } = await db.run("INSERT INTO categories (name, description, active, created_at, updated_at) VALUES (?, '', 1, ?, ?) RETURNING id", [cat, ts, ts]);
        for (const [name, unit] of arts) {
          await db.run(`INSERT INTO articles (code, name, category_id, unit_id, description, active, created_at, updated_at)
            VALUES (?, ?, ?, (SELECT id FROM units WHERE name = ?), '', 1, ?, ?)`, [`ART-${String(++n).padStart(4, '0')}`, name, cid, unit, ts, ts]);
        }
      }
    }
    if (!await db.value('SELECT COUNT(*) FROM users')) {
      const username = (process.env.ADMIN_USER || 'admin').toLowerCase();
      const generated = !process.env.ADMIN_PASSWORD;
      const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + '9a';
      await db.run(`INSERT INTO users (username, email, first_name, last_name, position, department_id, role, active, password_hash,
        must_change_password, created_at, updated_at) VALUES (?, ?, 'Superadministrador', 'del Sistema', 'Administrador del sistema',
        (SELECT id FROM departments WHERE code = 'TI'), 'superadmin', 1, ?, 1, ?, ?)`,
      [username, process.env.ADMIN_EMAIL || 'admin@herbaplant.local', hashPassword(password), ts, ts]);
      log('──────────────────────────────────────────────────────────');
      log(` Superadministrador inicial creado: usuario "${username}"`);
      if (generated) log(` Contraseña temporal: ${password}  (se pedirá cambiarla)`);
      log('──────────────────────────────────────────────────────────');
    }
  });
  if (process.env.SEED_DEMO === 'true') await seedDemo({ log: () => {} });
}

let ready;
/** Garantiza (una vez por proceso) que la BD esté migrada e inicializada. */
export function ensureReady() {
  if (!ready) ready = bootstrap().catch((e) => { ready = undefined; throw e; });
  return ready;
}

// ---------------------------------------------------------------------------
// Datos de demostración (npm run seed:demo, o SEED_DEMO=true en Vercel)
// ---------------------------------------------------------------------------

const DEMO_USERS = [
  ['gerente.produccion', 'María', 'González', 'Gerente de Producción', 'PRO', 'solicitante'],
  ['subgerente.calidad', 'Luis', 'Pérez', 'Subgerente de Control de Calidad', 'CC', 'solicitante'],
  ['gerente.mantenimiento', 'Carlos', 'Rodríguez', 'Gerente de Mantenimiento', 'MAN', 'solicitante'],
  ['analista.compras', 'Ana', 'Martínez', 'Analista de Compras', 'COM', 'compras'],
  ['jefe.compras', 'José', 'Hernández', 'Jefe de Compras', 'COM', 'compras'],
  ['gerente.administracion', 'Carmen', 'López', 'Gerente de Administración', 'ADM', 'administracion'],
  ['analista.administracion', 'Pedro', 'Díaz', 'Analista Administrativo', 'ADM', 'administracion'],
];

const DEMO_SUPPLIERS = [
  ['Distribuidora Científica del Centro, C.A.', 'J-30123456-7', 'Rosa Medina', '0241-8123456', 'ventas@dicience.example'],
  ['Papelería Universal, C.A.', 'J-29876543-1', 'Jorge Castillo', '0212-5551234', 'pedidos@papeluniversal.example'],
  ['Químicos y Reactivos Venezuela, S.A.', 'J-31234567-0', 'Elena Rivas', '0243-2345678', 'info@quimirev.example'],
  ['Empaques del Caribe, C.A.', 'J-40111222-3', 'Miguel Torres', '0241-8765432', 'comercial@empacaribe.example'],
  ['Servicios Técnicos Integrales, C.A.', 'J-41222333-4', 'Andrés Mora', '0414-1234567', 'servicios@stisa.example'],
];

export async function seedDemo({ log = console.log } = {}) {
  const password = process.env.DEMO_PASSWORD || 'Herbaplant2026';
  const ts = now();
  await tx(async () => {
    await db.get('SELECT pg_advisory_xact_lock(724503)');
    for (const [username, first, last, position, dept, role] of DEMO_USERS) {
      if (await db.get('SELECT 1 FROM users WHERE username = ?', [username])) continue;
      await db.run(`INSERT INTO users (username, email, first_name, last_name, position, department_id, role, active, password_hash,
        must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, (SELECT id FROM departments WHERE code = ?), ?, 1, ?, 0, ?, ?)`,
      [username, `${username}@herbaplant.example`, first, last, position, dept, role, hashPassword(password), ts, ts]);
      log(`  usuario ${username.padEnd(26)} rol ${role}`);
    }
    for (const [name, taxId, contact, phone, email] of DEMO_SUPPLIERS) {
      if (await db.get('SELECT 1 FROM suppliers WHERE name = ?', [name])) continue;
      await db.run(`INSERT INTO suppliers (name, tax_id, contact_name, phone, email, address, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)`, [name, taxId, contact, phone, email, ts, ts]);
    }
  });
  return password;
}
