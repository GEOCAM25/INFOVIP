/* ============================================================
   INFOVIP · Sella la versión en el Service Worker
   Reemplaza CACHE_VERSION con un valor único por build (fecha +
   SHA corto o número de run). Al cambiar, el SW invalida el caché
   viejo y las apps instaladas detectan y descargan la actualización.
   Uso: node scripts/stamp-version.mjs [version]
   ============================================================ */
import { readFileSync, writeFileSync } from 'node:fs';

const swPath = new URL('../www/service-worker.js', import.meta.url);
const verPath = new URL('../www/version.json', import.meta.url);
const arg = process.argv[2];
const stamp = arg || `${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`;

let src = readFileSync(swPath, 'utf8');
src = src.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = 'infovip-${stamp}';`);
writeFileSync(swPath, src);

// version.json: el número de build (primer entero del stamp, p.ej. "12-abc123" -> 12)
const build = parseInt(String(stamp).match(/^\d+/)?.[0] || '0', 10);
writeFileSync(verPath, JSON.stringify({ build, version: stamp, date: new Date().toISOString() }, null, 2) + '\n');

console.log(`[stamp] CACHE_VERSION => infovip-${stamp} · build ${build}`);
