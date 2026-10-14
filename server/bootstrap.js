import crypto from 'node:crypto';
import { getDb, now } from './lib/db.js';
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
export function bootstrap({ log = console.log } = {}) {
  const db = getDb();
  const ts = now();
  db.transaction(() => {
    if (!db.prepare('SELECT COUNT(*) FROM role_permissions').pluck().get()) {
      const ins = db.prepare('INSERT INTO role_permissions (role, permission) VALUES (?, ?)');
      for (const [role, perms] of Object.entries(PERMISOS_POR_DEFECTO)) perms.forEach((p) => ins.run(role, p));
    }
    if (!db.prepare('SELECT COUNT(*) FROM departments').pluck().get()) {
      const ins = db.prepare('INSERT INTO departments (name, code, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
      DEPARTAMENTOS.forEach(([n, c]) => ins.run(n, c, ts, ts));
    }
    if (!db.prepare('SELECT COUNT(*) FROM units').pluck().get()) {
      const ins = db.prepare('INSERT INTO units (name, abbreviation, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
      UNIDADES.forEach(([n, a]) => ins.run(n, a, ts, ts));
    }
    if (!db.prepare('SELECT COUNT(*) FROM categories').pluck().get()) {
      const insC = db.prepare('INSERT INTO categories (name, description, active, created_at, updated_at) VALUES (?, \'\', 1, ?, ?)');
      const insA = db.prepare(`INSERT INTO articles (code, name, category_id, unit_id, description, active, created_at, updated_at)
        VALUES (?, ?, ?, (SELECT id FROM units WHERE name = ?), '', 1, ?, ?)`);
      let n = 0;
      for (const [cat, arts] of Object.entries(CATALOGO)) {
        const cid = insC.run(cat, ts, ts).lastInsertRowid;
        for (const [name, unit] of arts) insA.run(`ART-${String(++n).padStart(4, '0')}`, name, cid, unit, ts, ts);
      }
    }
    if (!db.prepare('SELECT COUNT(*) FROM users').pluck().get()) {
      const username = (process.env.ADMIN_USER || 'admin').toLowerCase();
      const generated = !process.env.ADMIN_PASSWORD;
      const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url') + '9a';
      db.prepare(`INSERT INTO users (username, email, first_name, last_name, position, department_id, role, active, password_hash,
        must_change_password, created_at, updated_at) VALUES (?, ?, 'Superadministrador', 'del Sistema', 'Administrador del sistema',
        (SELECT id FROM departments WHERE code = 'TI'), 'superadmin', 1, ?, 1, ?, ?)`)
        .run(username, process.env.ADMIN_EMAIL || 'admin@herbaplant.local', hashPassword(password), ts, ts);
      log('──────────────────────────────────────────────────────────');
      log(` Superadministrador inicial creado: usuario "${username}"`);
      if (generated) log(` Contraseña temporal: ${password}  (se pedirá cambiarla)`);
      log('──────────────────────────────────────────────────────────');
    }
  })();
}
