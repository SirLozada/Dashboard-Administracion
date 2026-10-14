import { db } from './db.js';

export const DEFAULT_SETTINGS = {
  empresa_nombre: 'Laboratorios Herbaplant',
  req_prefijo: 'REQ',
  moneda_principal: 'USD',
  monedas: 'USD,VES,EUR',
  dias_credito: '30',
  tolerancia_sobrecosto_pct: '10',
  max_archivo_mb: '10',
  sesion_horas: '12',
};

// En Vercel el cuerpo de una petición no puede superar 4,5 MB.
export const PLATFORM_MAX_MB = process.env.VERCEL ? 4 : 50;

export async function getSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export const getSetting = async (key) => (await getSettings())[key];
export const getCurrencies = async () => (await getSetting('monedas')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
export const maxUploadMb = async () => Math.min(Number(await getSetting('max_archivo_mb')) || 10, PLATFORM_MAX_MB);
