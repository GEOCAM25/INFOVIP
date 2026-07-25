/* ============================================================
   INFOVIP · Puente de hardware nativo
   Usa plugins de Capacitor cuando la app corre como APK.
   En el navegador degrada a las Web APIs equivalentes.
   ============================================================ */

// Capacitor inyecta window.Capacitor cuando corre nativo.
const Cap = () => (typeof window !== 'undefined' ? window.Capacitor : undefined);
export const isNative = () => !!(Cap() && Cap().isNativePlatform && Cap().isNativePlatform());

function plugin(name) {
  const c = Cap();
  return c && c.Plugins ? c.Plugins[name] : undefined;
}

/* ---------- Geolocalización ---------- */
export const geo = {
  async current() {
    const Geolocation = plugin('Geolocation');
    if (Geolocation) {
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
      return { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy };
    }
    // Fallback web
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocalización no disponible'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        (e) => reject(e),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  },
  // watch continuo (para el motor de reglas). Devuelve función para detener.
  async watch(cb) {
    const Geolocation = plugin('Geolocation');
    if (Geolocation) {
      const id = await Geolocation.watchPosition({ enableHighAccuracy: true }, (p) => {
        if (p && p.coords) cb({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy });
      });
      return () => Geolocation.clearWatch({ id });
    }
    if (navigator.geolocation) {
      const id = navigator.geolocation.watchPosition(
        (p) => cb({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        () => {}, { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(id);
    }
    return () => {};
  }
};

/* ---------- Batería + info de dispositivo ---------- */
export const device = {
  async battery() {
    const Device = plugin('Device');
    if (Device && Device.getBatteryInfo) {
      const b = await Device.getBatteryInfo();
      return { level: Math.round((b.batteryLevel ?? 1) * 100), charging: !!b.isCharging };
    }
    if (navigator.getBattery) {
      const b = await navigator.getBattery();
      return { level: Math.round(b.level * 100), charging: b.charging };
    }
    return { level: null, charging: null };
  },
  async info() {
    const Device = plugin('Device');
    if (Device && Device.getInfo) return Device.getInfo();
    return { platform: 'web', model: navigator.userAgent };
  },
  // Identificador estable del dispositivo. En Android 10+ el IMEI ya no es
  // legible por apps; Capacitor entrega un id propio persistente que sirve
  // igual para "atar" la app a un teléfono concreto.
  async rawId() {
    const Device = plugin('Device');
    if (Device && Device.getId) {
      const r = await Device.getId();
      return r.identifier || r.uuid || '';
    }
    // Web / navegador: id sintético persistido en localStorage.
    try {
      let id = localStorage.getItem('infovip:webDeviceId');
      if (!id) {
        const a = new Uint8Array(16); crypto.getRandomValues(a);
        id = [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('infovip:webDeviceId', id);
      }
      return id;
    } catch (_) { return 'web-unknown'; }
  }
};

/* ---------- Vibración / hápticos ---------- */
export const haptics = {
  vibrate(ms = 200) {
    const Haptics = plugin('Haptics');
    if (Haptics && Haptics.vibrate) { Haptics.vibrate({ duration: ms }); return; }
    if (navigator.vibrate) navigator.vibrate(ms);
  }
};

/* ---------- Utilidad geográfica (Haversine, metros) ---------- */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
