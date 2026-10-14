// Constantes compartidas entre servidor y cliente.

export const ROLES = {
  solicitante: 'Solicitante',
  compras: 'Compras',
  administracion: 'Administración',
  superadmin: 'Superadministrador',
};

export const PRIORIDADES = {
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

// Estados de la requisición. `paso` corresponde al flujo general (1-12).
export const ESTADOS = {
  borrador: { label: 'Borrador', tone: 'gray', paso: 1 },
  enviada: { label: 'Enviada a Compras', tone: 'blue', paso: 2 },
  en_revision: { label: 'En revisión por Compras', tone: 'indigo', paso: 3 },
  devuelta_solicitante: { label: 'Devuelta para corrección', tone: 'orange', paso: 2 },
  devuelta_compras: { label: 'Devuelta a Compras', tone: 'orange', paso: 3 },
  pendiente_aprobacion: { label: 'Pendiente de aprobación', tone: 'amber', paso: 5 },
  aprobada: { label: 'Aprobada', tone: 'green', paso: 6 },
  rechazada: { label: 'Rechazada', tone: 'red', paso: 6 },
  en_compra: { label: 'En proceso de compra', tone: 'teal', paso: 7 },
  compra_parcial: { label: 'Compra parcial', tone: 'teal', paso: 8 },
  compra_ejecutada: { label: 'Compra ejecutada', tone: 'teal', paso: 8 },
  facturada: { label: 'Facturas registradas', tone: 'purple', paso: 9 },
  pendiente_pago: { label: 'Pendiente de pago', tone: 'amber', paso: 10 },
  pagada: { label: 'Pagada', tone: 'green', paso: 11 },
  cerrada: { label: 'Cerrada', tone: 'dark', paso: 12 },
  anulada: { label: 'Anulada', tone: 'gray', paso: 0 },
};

export const FLUJO = [
  'Borrador',
  'Enviada a Compras',
  'En revisión por Compras',
  'Revisada y enviada a Administración',
  'Pendiente de aprobación',
  'Aprobada / rechazada',
  'En proceso de compra',
  'Compra parcial o ejecutada',
  'Facturas registradas',
  'Pendiente de pago',
  'Pagada',
  'Cerrada',
];

// Agrupaciones de estados usadas en indicadores.
export const GRUPOS = {
  pendientes: ['enviada', 'en_revision', 'devuelta_solicitante', 'devuelta_compras', 'pendiente_aprobacion'],
  aprobadas: ['aprobada', 'en_compra', 'compra_parcial', 'compra_ejecutada', 'facturada', 'pendiente_pago', 'pagada'],
  enCompra: ['en_compra', 'compra_parcial'],
  ejecucion: ['aprobada', 'en_compra', 'compra_parcial', 'compra_ejecutada', 'facturada', 'pendiente_pago', 'pagada'],
};

export const ESTADOS_PAGO = {
  pendiente: { label: 'Pendiente', tone: 'gray' },
  programado: { label: 'Programado', tone: 'blue' },
  parcial: { label: 'Parcialmente pagado', tone: 'amber' },
  pagado: { label: 'Pagado', tone: 'green' },
  vencido: { label: 'Vencido', tone: 'red' },
};

export const METODOS_PAGO = {
  transferencia: 'Transferencia bancaria',
  pago_movil: 'Pago móvil',
  efectivo: 'Efectivo',
  cheque: 'Cheque',
  zelle: 'Zelle',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

// Catálogo de permisos. Cada módulo futuro (p. ej. Viáticos) agrega los suyos.
export const PERMISOS = {
  'req.crear': 'Crear y corregir requisiciones de su departamento',
  'req.ver_departamento': 'Consultar requisiciones de su departamento',
  'req.ver_todas': 'Consultar requisiciones de todos los departamentos',
  'req.ver_finanzas': 'Ver precios, cotizaciones, facturas y pagos',
  'req.revisar': 'Revisar y cotizar requisiciones (Compras)',
  'req.aprobar': 'Aprobar, rechazar o devolver requisiciones',
  'req.cerrar': 'Cerrar requisiciones pagadas',
  'compras.ejecutar': 'Registrar compras ejecutadas',
  'facturas.registrar': 'Cargar facturas de compras',
  'catalogo.validar': 'Incorporar artículos no registrados al catálogo',
  'proveedores.gestionar': 'Gestionar proveedores',
  'pagos.gestionar': 'Programar y registrar pagos',
  'pagos.sobrepago': 'Autorizar pagos extraordinarios superiores al saldo',
  'reportes.ver': 'Consultar reportes administrativos',
  'admin.usuarios': 'Crear y administrar usuarios',
  'admin.departamentos': 'Configurar departamentos',
  'admin.catalogo': 'Modificar el catálogo de artículos',
  'admin.permisos': 'Gestionar permisos por rol',
  'admin.auditoria': 'Consultar auditoría',
  'admin.parametros': 'Configurar parámetros generales',
};

export const PERMISOS_POR_DEFECTO = {
  solicitante: ['req.crear', 'req.ver_departamento'],
  compras: [
    'req.ver_todas', 'req.ver_finanzas', 'req.revisar', 'compras.ejecutar',
    'facturas.registrar', 'catalogo.validar', 'proveedores.gestionar',
  ],
  administracion: [
    'req.ver_todas', 'req.ver_finanzas', 'req.aprobar', 'req.cerrar',
    'pagos.gestionar', 'reportes.ver', 'proveedores.gestionar',
  ],
  superadmin: [
    'req.ver_todas', 'admin.usuarios', 'admin.departamentos', 'admin.catalogo', 'admin.permisos',
    'admin.auditoria', 'admin.parametros', 'proveedores.gestionar',
  ],
};

// `pagos.sobrepago` no se asigna a ningún rol por defecto: el superadministrador
// lo concede de forma individual a los usuarios autorizados (autorización controlada).

// Permisos que no pueden retirarse al superadministrador (evita bloquear el sistema).
export const PERMISOS_BLOQUEADOS_SUPERADMIN = ['admin.permisos', 'admin.usuarios'];

export const TIPOS_ARCHIVO = ['application/pdf', 'image/jpeg', 'image/png'];

export const MONEDAS = ['USD', 'VES', 'EUR'];
