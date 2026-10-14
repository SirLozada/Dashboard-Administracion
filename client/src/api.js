// Cliente HTTP: maneja sesión expirada, errores de conexión y mensajes del servidor.

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body, { form, signal } = {}) {
  const headers = { 'x-requested-with': 'herbaplant' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'No hay conexión con el servidor. Verifique su red e intente de nuevo.');
  }
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/auth/login')) onUnauthorized();
    const msg = data?.error || (res.status >= 500 ? 'El servidor presentó un error. Intente nuevamente.' : 'No se pudo completar la operación.');
    throw new ApiError(res.status, msg, data?.details);
  }
  return data;
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, fields = {}, file) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') fd.append(k, typeof v === 'boolean' ? String(v) : v);
    if (file) fd.append('archivo', file);
    return request('POST', url, undefined, { form: fd });
  },
};

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
}
