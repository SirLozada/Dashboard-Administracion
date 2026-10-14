import requisiciones from './requisiciones/index.js';

// Registro de módulos funcionales. Para agregar un módulo (p. ej. Viáticos): crear su carpeta con
// `index.js` exportando { key, name, mount(app) } y añadirlo aquí; sus permisos se declaran en
// shared/constants.js y su navegación en client/src/modules.js.
export const MODULES = [requisiciones];
