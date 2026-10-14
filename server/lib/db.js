import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './schema.js';
import { configError } from './errors.js';

// Base de datos PostgreSQL:
// - Producción / Vercel: servidor Postgres indicado en DATABASE_URL (p. ej. Neon).
// - Local y pruebas: PGlite (Postgres embebido) persistido en DATA_DIR/pgdata, sin instalar nada.

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const als = new AsyncLocalStorage();
let driver;

async function createDriver() {
  if (DATABASE_URL) {
    const { default: pg } = await import('pg');
    pg.types.setTypeParser(20, (v) => Number(v)); // bigint (COUNT, SUM de enteros)
    pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX) || 5,
      ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    });
    return {
      query: async (sql, params, client) => {
        const r = await (client || pool).query(sql, params);
        return { rows: r.rows, changes: r.rowCount ?? 0 };
      },
      exec: (sql, client) => (client || pool).query(sql),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(client);
          await client.query('COMMIT');
          return out;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }

  if (process.env.VERCEL) {
    throw configError('Falta la base de datos: en Vercel → Storage, conecte una base Neon (Postgres) al proyecto y vuelva a publicar (Redeploy).');
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const dir = path.join(DATA_DIR, 'pgdata');
  fs.mkdirSync(dir, { recursive: true });
  const lite = await PGlite.create(dir, {
    extensions: { citext },
    parsers: { 20: (v) => Number(v), 1700: (v) => Number(v) },
  });
  return {
    query: async (sql, params, client) => {
      const r = await (client || lite).query(sql, params);
      return { rows: r.rows, changes: r.affectedRows ?? 0 };
    },
    exec: (sql, client) => (client || lite).exec(sql),
    transaction: (fn) => lite.transaction(fn),
    close: () => lite.close(),
  };
}

let initPromise;
/** Abre la conexión y aplica las migraciones pendientes (una sola vez por proceso). */
export function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      driver = await createDriver();
      try {
        await migrate();
      } catch (e) {
        if (e.expose) throw e;
        console.error('Error al conectar o migrar la base de datos:', e);
        throw configError(`No se pudo conectar con la base de datos (${e.code || e.message}). Verifique la conexión de Neon en Vercel → Storage.`);
      }
    })().catch((e) => { initPromise = undefined; throw e; });
  }
  return initPromise;
}

/** Estado de la base de datos para el diagnóstico (/api/salud). */
export async function dbStatus() {
  try {
    await initDb();
    await query('SELECT 1');
    return { ok: true, motor: DATABASE_URL ? 'postgres' : 'pglite' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function closeDb() {
  if (driver) await driver.close();
  driver = undefined;
  initPromise = undefined;
}

async function migrate() {
  await driver.transaction(async (client) => {
    // Evita que dos instancias migren a la vez.
    await driver.query('SELECT pg_advisory_xact_lock(724501)', [], client);
    await driver.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)', client);
    const { rows } = await driver.query('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations', [], client);
    for (let v = rows[0].v; v < MIGRATIONS.length; v++) {
      await driver.exec(MIGRATIONS[v], client);
      await driver.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [v + 1, now()], client);
    }
  });
}

/**
 * Convierte parámetros estilo `?` (posicionales) o `@nombre` (objeto) a `$n` de Postgres,
 * ignorando el contenido de literales de texto.
 */
function compile(sql, params) {
  const named = params && !Array.isArray(params) && typeof params === 'object';
  const values = [];
  const index = new Map();
  let positional = 0;
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") { inStr = !inStr; out += ch; continue; }
    if (inStr) { out += ch; continue; }
    if (ch === '?' && !named) {
      const v = params?.[positional++];
      values.push(v === undefined ? null : v);
      out += `$${values.length}`;
    } else if (ch === '@' && named && /[a-zA-Z_]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /\w/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      if (!index.has(name)) {
        const v = params[name];
        values.push(v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
        index.set(name, values.length);
      }
      out += `$${index.get(name)}`;
      i = j - 1;
    } else {
      out += ch;
    }
  }
  return [out, values.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))];
}

async function query(sql, params) {
  if (!driver) await initDb();
  const [text, values] = compile(sql, params);
  return driver.query(text, values, als.getStore()?.client);
}

const toArgs = (args) => (args.length === 1 && (Array.isArray(args[0]) || (args[0] && typeof args[0] === 'object')) ? args[0] : args);

/** API de acceso a datos (todas las funciones son asíncronas). */
export const db = {
  /** Primera fila o undefined. */
  get: async (sql, ...args) => (await query(sql, toArgs(args))).rows[0],
  /** Todas las filas. */
  all: async (sql, ...args) => (await query(sql, toArgs(args))).rows,
  /** Valor de la primera columna de la primera fila. */
  value: async (sql, ...args) => { const r = (await query(sql, toArgs(args))).rows[0]; return r ? Object.values(r)[0] : undefined; },
  /** Primera columna de todas las filas. */
  column: async (sql, ...args) => (await query(sql, toArgs(args))).rows.map((r) => Object.values(r)[0]),
  /** Ejecuta una sentencia. Para INSERT agregue `RETURNING id` y use `id`. */
  run: async (sql, ...args) => { const r = await query(sql, toArgs(args)); return { changes: r.changes, id: r.rows[0]?.id }; },
  /** ¿Se está ejecutando dentro de una transacción? */
  inTx: () => !!als.getStore(),
};

/** Ejecuta `fn` en una transacción; las consultas internas de `db` la usan automáticamente. */
export async function tx(fn) {
  if (!driver) await initDb();
  if (als.getStore()) return fn();
  return driver.transaction((client) => als.run({ client }, fn));
}

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
