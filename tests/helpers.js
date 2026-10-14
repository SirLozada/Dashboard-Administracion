import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

/** Levanta la aplicación con una base de datos temporal y datos de demostración. */
export async function startServer() {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'herbaplant-test-'));
  process.env.ADMIN_PASSWORD = 'Admin12345';
  process.env.DEMO_PASSWORD = 'Herbaplant2026';
  const { bootstrap, seedDemo } = await import('../server/bootstrap.js');
  const { createApp } = await import('../server/app.js');
  const { closeDb } = await import('../server/lib/db.js');
  await bootstrap({ log: () => {} });
  await seedDemo({ log: () => {} });
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await closeDb(); } };
}

export function client(base) {
  let cookie = '';
  async function call(method, url, body, { form } = {}) {
    const headers = { 'x-requested-with': 'herbaplant' };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data };
  }
  const c = {
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b ?? {}),
    put: (u, b) => call('PUT', u, b),
    del: (u) => call('DELETE', u),
    upload: (u, fields, file = PDF, name = 'doc.pdf') => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
      if (file) fd.append('archivo', new Blob([file]), name);
      return call('POST', u, undefined, { form: fd });
    },
    async login(usuario, password = 'Herbaplant2026') {
      const r = await call('POST', '/api/auth/login', { usuario, password });
      if (r.status !== 200) throw new Error(`login ${usuario}: ${JSON.stringify(r.data)}`);
      return r.data.user;
    },
  };
  return c;
}
