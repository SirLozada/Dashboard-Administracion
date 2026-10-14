// Registro de navegación por módulo. Cada ítem se muestra solo si el usuario tiene alguno de sus permisos.
// Para incorporar un nuevo módulo (p. ej. Viáticos) basta con agregar su sección aquí y sus rutas en App.jsx.
export const NAV = [
  {
    section: 'General',
    items: [
      { to: '/', label: 'Inicio', icon: 'home', end: true },
      { to: '/notificaciones', label: 'Notificaciones', icon: 'bell' },
    ],
  },
  {
    section: 'Requisiciones',
    module: 'requisiciones',
    items: [
      { to: '/requisiciones/nueva', label: 'Nueva requisición', icon: 'plus', perms: ['req.crear'] },
      { to: '/requisiciones', label: 'Requisiciones', icon: 'list', end: true, perms: ['req.crear', 'req.ver_departamento', 'req.ver_todas'] },
      { to: '/pagos', label: 'Pagos de requisiciones', icon: 'dollar', perms: ['pagos.gestionar'] },
      { to: '/reportes', label: 'Reportes', icon: 'chart', perms: ['reportes.ver'] },
      { to: '/proveedores', label: 'Proveedores', icon: 'truck', perms: ['proveedores.gestionar'] },
    ],
  },
  {
    section: 'Configuración',
    items: [
      { to: '/configuracion/usuarios', label: 'Usuarios', icon: 'users', perms: ['admin.usuarios'] },
      { to: '/configuracion/departamentos', label: 'Departamentos', icon: 'building', perms: ['admin.departamentos'] },
      { to: '/configuracion/catalogo', label: 'Catálogo de artículos', icon: 'box', perms: ['admin.catalogo'] },
      { to: '/configuracion/permisos', label: 'Permisos', icon: 'shield', perms: ['admin.permisos'] },
      { to: '/configuracion/auditoria', label: 'Auditoría', icon: 'clock', perms: ['admin.auditoria'] },
      { to: '/configuracion/parametros', label: 'Parámetros generales', icon: 'settings', perms: ['admin.parametros'] },
    ],
  },
];
