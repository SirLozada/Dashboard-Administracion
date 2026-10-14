export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const forbidden = (msg = 'No tiene permisos para realizar esta acción.') => new HttpError(403, msg);
export const notFound = (msg = 'Registro no encontrado.') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Valida `data` con un esquema zod y lanza 400 con mensajes legibles. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw badRequest(details[0]?.message || 'Datos inválidos.', details);
  }
  return r.data;
}

/** Error de configuración del servidor: su mensaje es seguro y útil para mostrarlo al usuario. */
export function configError(message) {
  const e = new Error(message);
  e.status = 503;
  e.expose = true;
  return e;
}
