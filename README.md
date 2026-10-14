# Herbaplant · Sistema de Gestión Administrativa

Aplicación web corporativa de **Laboratorios Herbaplant**. Fase 1: **Módulo de Requisiciones** — un gerente solicita bienes o servicios sin ver precios, Compras revisa y cotiza, Administración aprueba y controla facturas y pagos, y cada etapa queda documentada.

## Puesta en marcha

Requisitos: Node.js 20.10 o superior.

```bash
npm install
npm run build          # compila la interfaz (client/dist)
npm start              # http://localhost:3000
```

En el primer arranque se crea la base de datos (`data/herbaplant.db`), el catálogo base, los departamentos y el **superadministrador** `admin`. Su contraseña temporal se muestra en la consola (o defínala con `ADMIN_PASSWORD`); se pide cambiarla al ingresar.

Datos de demostración (usuarios por rol y proveedores, contraseña `Herbaplant2026`):

```bash
npm run seed:demo
```

| Usuario | Rol |
|---|---|
| `gerente.produccion`, `subgerente.calidad`, `gerente.mantenimiento` | Solicitante |
| `analista.compras`, `jefe.compras` | Compras |
| `gerente.administracion`, `analista.administracion` | Administración |
| `admin` | Superadministrador |

Desarrollo con recarga: `npm run dev` (API en :3000, interfaz Vite en :5173). Pruebas: `npm test`.

### Variables de entorno

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP (3000) |
| `DATA_DIR` | Carpeta de la base de datos y los adjuntos (`./data`) — respaldar periódicamente |
| `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` | Superadministrador inicial |
| `COOKIE_SECURE=true` | Cookie de sesión solo por HTTPS (recomendado en producción) |
| `TRUST_PROXY=true` | Si corre detrás de un proxy inverso (nginx, etc.) |

## Flujo de la requisición

Borrador → Enviada a Compras → En revisión por Compras → Revisada y enviada a Administración / Pendiente de aprobación → Aprobada o Rechazada → En proceso de compra → Compra parcial o ejecutada → Facturas registradas → Pendiente de pago → Pagada → Cerrada.

Devoluciones: Compras puede devolver al departamento; Administración puede devolver a Compras o al departamento. Cada movimiento registra usuario, fecha/hora y observación en la línea de tiempo.

## Roles y controles

- **Solicitante**: crea, corrige y consulta requisiciones de su departamento. El servidor nunca le envía precios, cotizaciones, facturas, pagos ni eventos internos.
- **Compras**: recibe, valida cantidades, asigna proveedores y precios, adjunta cotizaciones, envía a Administración, registra compras (incluso parciales) y facturas, e incorpora artículos no registrados al catálogo.
- **Administración**: aprueba, rechaza (motivo obligatorio) o devuelve; gestiona *Pagos de requisiciones* (programación, pagos parciales, comprobantes) y reportes.
- **Superadministrador**: usuarios, departamentos, catálogo, permisos por rol, auditoría y parámetros. No ve datos financieros por defecto.

Controles implementados en el servidor:

- Permisos configurables por rol y permisos individuales adicionales.
- Segregación de funciones: quien revisó/cotizó o solicitó no puede aprobar.
- No se registran compras sin aprobación vigente; las cantidades no superan lo aprobado y el total no supera el monto aprobado más la tolerancia configurada.
- Pagos superiores al saldo solo con el permiso individual `pagos.sobrepago`, justificación obligatoria, auditoría y aviso a los auditores.
- Prevención de duplicados: token por formulario, facturas únicas por proveedor, referencias de pago repetidas y control de concurrencia en los cambios de estado.
- Archivos (PDF/JPG/PNG validados por firma) servidos solo tras verificar permisos.
- Contraseñas con scrypt, sesiones con cookie HttpOnly/SameSite, límite de intentos de acceso, protección CSRF y bitácora de auditoría.
- Notificaciones internas en tiempo real (SSE) con campana y contador.

## Arquitectura

```
shared/constants.js          estados, roles y permisos (servidor y cliente)
server/
  app.js, index.js           Express, seguridad, manejo de errores
  lib/                       BD (SQLite + migraciones), auth, archivos, notificaciones, auditoría
  modules/core/              autenticación, notificaciones, archivos, administración del sistema
  modules/requisiciones/     requisiciones, pagos, reportes (registrado en modules/index.js)
client/src/
  modules.js                 navegación por módulo y permiso
  pages/, components/        interfaz React
tests/                       pruebas de integración del flujo completo
```

**Agregar un módulo (p. ej. Viáticos):** crear `server/modules/viaticos/index.js` con `{ key, name, mount(app) }` y registrarlo en `server/modules/index.js`; declarar sus permisos en `shared/constants.js`; añadir su sección de navegación en `client/src/modules.js` y sus rutas en `client/src/App.jsx`. Usuarios, permisos, notificaciones, archivos y auditoría se reutilizan sin cambios. Los cambios de esquema se agregan como nuevas migraciones en `server/lib/schema.js`.
