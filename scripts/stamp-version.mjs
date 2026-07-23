/* ============================================================
   INFOVIP · Sella la versión en el Service Worker
   Reemplaza CACHE_VERSION con un valor único por build (fecha +
   SHA corto o número de run). Al cambiar, el SW invalida el caché
   viejo y las apps instaladas detectan y descargan la actualización.
   Uso: node scripts/stamp-version.mjs [version]
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';

const swPath = new URL('../www/service-worker.js', import.meta.url);
const arg = process.argv[2];
const stamp = arg || `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

let src = readFileSync(swPath, 'utf8');
src = src.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'infovip-${stamp}';`);
writeFileSync(swPath, src);

console.log(`[stamp] CACHE_VERSION => infovip-${stamp}`);
