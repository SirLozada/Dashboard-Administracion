import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { sessionMiddleware } from './lib/auth.js';
import { HttpError } from './lib/errors.js';
import { discardUpload } from './lib/files.js';
import core from './modules/core/routes.js';
import { MODULES } from './modules/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../client/dist');

export function createApp() {
  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], frameSrc: ["'self'"], objectSrc: ["'self'"], upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', sessionMiddleware);

  // Protección CSRF: toda petición que modifica datos debe venir de la aplicación (cabecera personalizada
  // + cookie SameSite=Strict). Un formulario de otro sitio no puede enviar esta cabecera.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'herbaplant') {
      return next(new HttpError(403, 'Solicitud no permitida.'));
    }
    next();
  });

  app.get('/api/salud', (_req, res) => res.json({ ok: true, modulos: MODULES.map((m) => m.key) }));
  app.use('/api', core);
  for (const m of MODULES) m.mount(app);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Recurso no encontrado.')));

  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  // Manejo centralizado de errores: mensajes claros y sin filtrar detalles internos.
  app.use((err, req, res, _next) => {
    discardUpload(req.file);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, details: err.details });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Formato de datos inválido.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' });
    if (String(err?.code).startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'La operación entra en conflicto con datos existentes (posible duplicado).' });
    }
    if (String(err?.code) === 'SQLITE_BUSY') return res.status(503).json({ error: 'El sistema está ocupado. Intente nuevamente en unos segundos.' });
    console.error(err);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Intente nuevamente.' });
  });
  return app;
}
