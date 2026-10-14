import { createApp } from './app.js';
import { ensureReady } from './bootstrap.js';

await ensureReady();
const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Herbaplant · Gestión Administrativa escuchando en http://localhost:${port}`);
});
