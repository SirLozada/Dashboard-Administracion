import { z } from 'zod';

export const id = z.coerce.number().int().positive();
export const optId = z.preprocess((v) => (v === '' || v === undefined || v === null ? null : v), z.coerce.number().int().positive().nullable());
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (use AAAA-MM-DD).');
export const optDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), date.nullable());
export const text = (max = 2000) => z.preprocess((v) => (v ?? ''), z.string().trim().max(max, `Máximo ${max} caracteres.`));
export const reqText = (label, min = 1, max = 2000) =>
  z.preprocess((v) => (v ?? ''), z.string().trim().min(min, `${label} es obligatorio${min > 1 ? ` (mínimo ${min} caracteres)` : ''}.`).max(max));
export const money = z.coerce.number().finite().nonnegative('El monto no puede ser negativo.').max(1e12);
export const positiveMoney = z.coerce.number().finite().positive('El monto debe ser mayor que cero.').max(1e12);
export const bool = z.preprocess((v) => v === true || v === 'true' || v === '1' || v === 1 || v === 'on', z.boolean());
