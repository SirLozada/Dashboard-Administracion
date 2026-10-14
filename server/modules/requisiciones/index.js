import requisiciones from './routes.js';
import pagos from './payments.js';
import reportes from './reports.js';

/** Módulo de Requisiciones (Fase 1). */
export default {
  key: 'requisiciones',
  name: 'Requisiciones',
  mount(app) {
    app.use('/api/requisiciones', requisiciones);
    app.use('/api/pagos', pagos);
    app.use('/api/reportes', reportes);
  },
};
