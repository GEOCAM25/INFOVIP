/* ============================================================
   INFOVIP · Cerca geográfica (área permitida)
   La app solo funciona dentro de un área definida (p.ej. Puente Alto).
   Si el teléfono sale de esos límites, se bloquea (anti-robo: si se lo
   llevan lejos, deja de funcionar). El área la define el administrador:
     - de forma GLOBAL en GitHub (campo "geofence" en authorized.json), o
     - de forma LOCAL desde el mapa en la zona oculta de Ajustes.
   El área remota (GitHub) tiene prioridad sobre la local.
   Un área puede ser un CÍRCULO {lat, lon, radius(m)} o un POLÍGONO
   {polygon: [[lat,lon], ...]}.
   ============================================================ */
import { prefs } from './store.js';
import { geo } from './native.js';

export function getRemoteGeofence() { return prefs.get('geoRemote', null); }
export function setRemoteGeofence(gf) { if (gf && (gf.radius || gf.polygon)) prefs.set('geoRemote', gf); else prefs.remove('geoRemote'); }
export function getLocalGeofence() { return prefs.get('geoLocal', null); }
export function setLocalGeofence(gf) { if (gf && (gf.radius || gf.polygon)) prefs.set('geoLocal', gf); else prefs.remove('geoLocal'); }
export function activeGeofence() { return getRemoteGeofence() || getLocalGeofence() || null; }

// Distancia en metros (Haversine).
function meters(aLat, aLon, bLat, bLon) {
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Punto dentro de polígono (ray-casting). poly = [[lat,lon], ...].
function inPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
    const intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function isInside(gf, lat, lon) {
  if (!gf) return true;
  if (gf.polygon && gf.polygon.length >= 3) return inPolygon(lat, lon, gf.polygon);
  if (gf.lat != null && gf.radius) return meters(lat, lon, gf.lat, gf.lon) <= gf.radius;
  return true;
}

/* ---------- Estado de bloqueo geográfico ---------- */
export function isGeoBlocked() { return activeGeofence() != null && prefs.get('geoBlocked', false) === true; }
function setGeoBlocked(v) { prefs.set('geoBlocked', !!v); }

// Comprueba la posición actual contra el área. Devuelve 'inside'|'outside'|'unknown'.
// 'unknown' si no se pudo obtener ubicación (no bloquea por sí solo; el
// kill-switch de 6 h por internet sigue vigente igualmente).
export async function checkGeofence() {
  const gf = activeGeofence();
  if (!gf) { setGeoBlocked(false); return 'inside'; }
  let pos;
  try { pos = await geo.current(); } catch (_) { return 'unknown'; }
  const inside = isInside(gf, pos.lat, pos.lon);
  setGeoBlocked(!inside);
  prefs.set('geoLastPos', { lat: pos.lat, lon: pos.lon, at: Date.now() });
  return inside ? 'inside' : 'outside';
}

// Resumen legible del área activa (para Ajustes).
export function describeGeofence() {
  const gf = activeGeofence();
  if (!gf) return 'Sin área definida (no se restringe por ubicación).';
  const src = getRemoteGeofence() ? 'GitHub' : 'este teléfono';
  if (gf.polygon) return `Polígono de ${gf.polygon.length} puntos · definido en ${src}.`;
  return `Círculo de ${Math.round(gf.radius)} m · definido en ${src}.`;
}
