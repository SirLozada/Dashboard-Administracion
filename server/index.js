import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { getDb } from './lib/db.js';

getDb();
bootstrap();
const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Herbaplant · Gestión Administrativa escuchando en http://localhost:${port}`);
});
