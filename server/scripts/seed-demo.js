// Crea usuarios y proveedores de demostración. Uso: npm run seed:demo
import { bootstrap, seedDemo } from '../bootstrap.js';
import { closeDb } from '../lib/db.js';

await bootstrap();
const password = await seedDemo();
console.log(`Datos de demostración listos. Contraseña de los usuarios de prueba: ${password}`);
await closeDb();
