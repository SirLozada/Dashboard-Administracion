import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './schema.js';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

let db;

export function getDb() {
  if (!db) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    db = new Database(path.join(DATA_DIR, 'herbaplant.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    migrate(db);
  }
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = undefined;
}

function migrate(conn) {
  const current = conn.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    conn.transaction(() => {
      conn.exec(MIGRATIONS[v]);
      conn.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Ejecuta `fn` dentro de una transacción (inmediata, para evitar carreras de escritura). */
export function tx(fn) {
  return getDb().transaction(fn).immediate();
}

export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
