/* ============================================================
   INFOVIP · Ubicación en segundo plano (pantalla apagada)
   Usa @capacitor-community/background-geolocation, que corre un
   servicio en primer plano (con notificación persistente) para
   mantener el GPS vivo aunque la app esté cerrada o bloqueada.
   En web / sin plugin, cae al watch normal de geolocalización.
   ============================================================ */
function plugin() {
  const c = window.Capacitor;
  return c && c.Plugins ? c.Plugins.BackgroundGeolocation : undefined;
}
export function hasBackground() { return !!plugin(); }

let watcher = null; // string id (nativo) u objeto { stop } (web)

// Inicia la vigilancia. onLocation({lat,lon,acc}). Devuelve true si es nativo.
export async function start(onLocation, onError) {
  if (watcher) return hasBackground();
  const BG = plugin();
  if (BG) {
    watcher = await BG.addWatcher({
      backgroundMessage: 'Vigilando tus alarmas por ubicación.',
      backgroundTitle: 'INFOVIP activo',
      requestPermissions: true,
      stale: false,
      distanceFilter: 15   // metros mínimos entre lecturas (ahorra batería)
    }, (location, error) => {
      if (error) { onError && onError(error); return; }
      if (location) onLocation({ lat: location.latitude, lon: location.longitude, acc: location.accuracy });
    });
    return true;
  }
  // Fallback sin plugin (navegador o APK sin el plugin)
  const { geo } = await import('./native.js');
  const stop = await geo.watch(onLocation);
  watcher = { stop };
  return false;
}

export async function stop() {
  if (!watcher) return;
  const BG = plugin();
  try {
    if (BG && typeof watcher === 'string') await BG.removeWatcher({ id: watcher });
    else if (watcher && watcher.stop) watcher.stop();
  } catch (_) {}
  watcher = null;
}

export function isRunning() { return !!watcher; }
