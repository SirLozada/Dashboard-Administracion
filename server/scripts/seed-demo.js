// Crea usuarios y proveedores de demostración. Uso: npm run seed:demo
import { getDb, now } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { bootstrap } from '../bootstrap.js';

const PASSWORD = process.env.DEMO_PASSWORD || 'Herbaplant2026';

const USERS = [
  ['gerente.produccion', 'María', 'González', 'Gerente de Producción', 'PRO', 'solicitante'],
  ['subgerente.calidad', 'Luis', 'Pérez', 'Subgerente de Control de Calidad', 'CC', 'solicitante'],
  ['gerente.mantenimiento', 'Carlos', 'Rodríguez', 'Gerente de Mantenimiento', 'MAN', 'solicitante'],
  ['analista.compras', 'Ana', 'Martínez', 'Analista de Compras', 'COM', 'compras'],
  ['jefe.compras', 'José', 'Hernández', 'Jefe de Compras', 'COM', 'compras'],
  ['gerente.administracion', 'Carmen', 'López', 'Gerente de Administración', 'ADM', 'administracion'],
  ['analista.administracion', 'Pedro', 'Díaz', 'Analista Administrativo', 'ADM', 'administracion'],
];

const SUPPLIERS = [
  ['Distribuidora Científica del Centro, C.A.', 'J-30123456-7', 'Rosa Medina', '0241-8123456', 'ventas@dicience.example'],
  ['Papelería Universal, C.A.', 'J-29876543-1', 'Jorge Castillo', '0212-5551234', 'pedidos@papeluniversal.example'],
  ['Químicos y Reactivos Venezuela, S.A.', 'J-31234567-0', 'Elena Rivas', '0243-2345678', 'info@quimirev.example'],
  ['Empaques del Caribe, C.A.', 'J-40111222-3', 'Miguel Torres', '0241-8765432', 'comercial@empacaribe.example'],
  ['Servicios Técnicos Integrales, C.A.', 'J-41222333-4', 'Andrés Mora', '0414-1234567', 'servicios@stisa.example'],
];

getDb();
bootstrap();
const db = getDb();
const ts = now();
db.transaction(() => {
  for (const [username, first, last, position, dept, role] of USERS) {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) continue;
    db.prepare(`INSERT INTO users (username, email, first_name, last_name, position, department_id, role, active, password_hash,
      must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, (SELECT id FROM departments WHERE code = ?), ?, 1, ?, 0, ?, ?)`)
      .run(username, `${username}@herbaplant.example`, first, last, position, dept, role, hashPassword(PASSWORD), ts, ts);
    console.log(`  usuario ${username.padEnd(26)} rol ${role}`);
  }
  for (const [name, taxId, contact, phone, email] of SUPPLIERS) {
    if (db.prepare('SELECT 1 FROM suppliers WHERE name = ?').get(name)) continue;
    db.prepare(`INSERT INTO suppliers (name, tax_id, contact_name, phone, email, address, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '', 1, ?, ?)`).run(name, taxId, contact, phone, email, ts, ts);
  }
})();
console.log(`Datos de demostración listos. Contraseña de los usuarios de prueba: ${PASSWORD}`);
