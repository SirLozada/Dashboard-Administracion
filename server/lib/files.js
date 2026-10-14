import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { getDb, now, UPLOAD_DIR } from './db.js';
import { badRequest } from './errors.js';
import { getSetting } from './settings.js';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`),
});

/** Middleware multer para un único archivo en el campo `archivo`. */
export function uploadSingle(field = 'archivo') {
  return (req, res, next) => {
    const maxMb = Number(getSetting('max_archivo_mb')) || 10;
    multer({ storage, limits: { fileSize: maxMb * 1024 * 1024, files: 1 } }).single(field)(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(badRequest(`El archivo supera el tamaño máximo de ${maxMb} MB.`));
      if (err) return next(badRequest('No se pudo cargar el archivo. Intente nuevamente.'));
      next();
    });
  };
}

// Verifica el tipo real del archivo por su firma (no confía en la extensión).
function sniff(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export function discardUpload(file) {
  if (file?.path) fs.rm(file.path, { force: true }, () => {});
}

/**
 * Registra en BD un archivo recibido por multer. Debe llamarse dentro de la transacción del caso de uso.
 * Lanza 400 si el tipo no es PDF/JPG/PNG.
 */
export function storeUpload(file, { kind, requisitionId = null, userId }) {
  if (!file) throw badRequest('Debe adjuntar un archivo.');
  const mime = sniff(file.path);
  if (!mime) {
    discardUpload(file);
    throw badRequest('Formato no permitido. Solo se aceptan archivos PDF, JPG o PNG.');
  }
  const uuid = crypto.randomUUID();
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime];
  const stored = `${uuid}${ext}`;
  fs.renameSync(file.path, path.join(UPLOAD_DIR, stored));
  const name = path.basename(String(file.originalname || `archivo${ext}`)).slice(0, 200);
  const r = getDb().prepare(`INSERT INTO files (uuid, requisition_id, kind, original_name, stored_name, mime, size, uploaded_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(uuid, requisitionId, kind, name, stored, mime, file.size, userId, now());
  return { id: Number(r.lastInsertRowid), uuid, original_name: name, mime, size: file.size };
}

export const filePath = (stored) => path.join(UPLOAD_DIR, stored);

export const FINANCE_KINDS = new Set(['cotizacion', 'factura', 'comprobante']);
