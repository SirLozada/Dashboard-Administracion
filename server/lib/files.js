import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import multer from 'multer';
import { DATA_DIR, db, now } from './db.js';
import { badRequest, configError } from './errors.js';
import { maxUploadMb } from './settings.js';

// Almacenamiento de adjuntos: Vercel Blob (privado) si hay token; si no, disco local en DATA_DIR/uploads.
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

/** Middleware multer para un único archivo en el campo `archivo` (en memoria). */
export function uploadSingle(field = 'archivo') {
  return async (req, res, next) => {
    const maxMb = await maxUploadMb();
    multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024, files: 1 } }).single(field)(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(badRequest(`El archivo supera el tamaño máximo de ${maxMb} MB.`));
      if (err) return next(badRequest('No se pudo cargar el archivo. Intente nuevamente.'));
      next();
    });
  };
}

// Verifica el tipo real del archivo por su firma (no confía en la extensión).
function sniff(buf) {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

// Los archivos se guardan en memoria hasta registrarse; no hay temporales que limpiar.
export function discardUpload() {}

async function writeBlob(name, buffer, mime) {
  if (USE_BLOB) {
    const { put } = await import('@vercel/blob');
    try {
      const r = await put(`adjuntos/${name}`, buffer, { access: BLOB_ACCESS, contentType: mime, addRandomSuffix: true });
      return r.pathname;
    } catch (e) {
      console.error('Error de Vercel Blob:', e);
      throw configError(`No se pudo guardar el archivo en Vercel Blob (${e.message}). Si el almacén es público, agregue la variable BLOB_ACCESS=public.`);
    }
  }
  if (process.env.VERCEL) throw configError('Falta el almacén de archivos: en Vercel → Storage, conecte un Blob al proyecto y vuelva a publicar (Redeploy).');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return name;
}

/** Devuelve un stream legible del archivo almacenado, o null si no existe. */
export async function openStored(stored) {
  if (USE_BLOB) {
    const { get } = await import('@vercel/blob');
    const r = await get(stored, { access: BLOB_ACCESS }).catch(() => null);
    if (!r?.stream) return null;
    return Readable.fromWeb(r.stream);
  }
  const p = path.join(UPLOAD_DIR, path.basename(stored));
  return fs.existsSync(p) ? fs.createReadStream(p) : null;
}

/**
 * Registra un archivo recibido por multer. Lanza 400 si el tipo no es PDF/JPG/PNG.
 * Se llama dentro de la transacción del caso de uso.
 */
export async function storeUpload(file, { kind, requisitionId = null, userId }) {
  if (!file) throw badRequest('Debe adjuntar un archivo.');
  const mime = sniff(file.buffer);
  if (!mime) throw badRequest('Formato no permitido. Solo se aceptan archivos PDF, JPG o PNG.');
  const uuid = crypto.randomUUID();
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mime];
  const stored = await writeBlob(`${uuid}${ext}`, file.buffer, mime);
  const name = path.basename(String(file.originalname || `archivo${ext}`)).slice(0, 200);
  const r = await db.run(`INSERT INTO files (uuid, requisition_id, kind, original_name, stored_name, mime, size, uploaded_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`, [uuid, requisitionId, kind, name, stored, mime, file.size, userId, now()]);
  return { id: r.id, uuid, original_name: name, mime, size: file.size };
}

export const storageStatus = () => ({ blob: USE_BLOB, acceso: USE_BLOB ? BLOB_ACCESS : 'disco local' });

export const FINANCE_KINDS = new Set(['cotizacion', 'factura', 'comprobante']);
