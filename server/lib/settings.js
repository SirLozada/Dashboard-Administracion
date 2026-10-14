import { getDb } from './db.js';

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

export function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export const getSetting = (key) => getSettings()[key];
export const getCurrencies = () => getSetting('monedas').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
