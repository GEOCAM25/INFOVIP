/* ============================================================
   INFOVIP · Clima (Open-Meteo) para la automatización de clima
   Obtiene el clima de la ubicación actual y guarda el último
   registro para modo offline. Sin API key, gratis.
   ============================================================ */
import { geo } from './native.js';
import { db } from './db.js';

const WMO = {
  0: ['☀️', 'Despejado'], 1: ['🌤️', 'Mayormente despejado'], 2: ['⛅', 'Parcial nublado'], 3: ['☁️', 'Nublado'],
  45: ['🌫️', 'Niebla'], 48: ['🌫️', 'Niebla'], 51: ['🌦️', 'Llovizna'], 53: ['🌦️', 'Llovizna'], 55: ['🌧️', 'Llovizna intensa'],
  61: ['🌧️', 'Lluvia leve'], 63: ['🌧️', 'Lluvia'], 65: ['🌧️', 'Lluvia fuerte'], 71: ['🌨️', 'Nieve'], 73: ['🌨️', 'Nieve'],
  80: ['🌦️', 'Chubascos'], 81: ['🌧️', 'Chubascos'], 82: ['⛈️', 'Chubascos fuertes'], 95: ['⛈️', 'Tormenta'], 96: ['⛈️', 'Tormenta']
};

export async function getCurrentWeather() {
  let coords;
  try { const p = await geo.current(); coords = { lat: p.lat, lon: p.lon }; }
  catch (_) {
    const c = await db.get('cache', 'weatherCoords').catch(() => null);
    coords = (c && c.value) || { lat: -33.61, lon: -70.58 }; // Puente Alto por defecto
  }
  await db.put('cache', { key: 'weatherCoords', value: coords }).catch(() => {});

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
              `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('sin conexión');
  const data = await res.json();
  await db.put('cache', { key: 'weather', value: data, savedAt: Date.now() }).catch(() => {});
  return data;
}

export function summarize(data) {
  const cur = (data && data.current) || {};
  const [ico, desc] = WMO[cur.weather_code] || ['🌡️', '—'];
  const t = Math.round(cur.temperature_2m ?? 0);
  return {
    ico, desc, temp: t,
    text: `${ico} ${t}° · ${desc} · humedad ${cur.relative_humidity_2m ?? '—'}% · viento ${Math.round(cur.wind_speed_10m ?? 0)} km/h`
  };
}

// Último clima guardado (offline)
export async function lastWeather() {
  const c = await db.get('cache', 'weather').catch(() => null);
  return c ? { data: c.value, savedAt: c.savedAt } : null;
}

// Horas de amanecer/atardecer de HOY para la ubicación (cache por día).
export async function getSunTimes() {
  const today = new Date().toISOString().slice(0, 10);
  const cached = await db.get('cache', 'sun').catch(() => null);
  if (cached && cached.day === today && cached.sunrise) {
    return { sunrise: new Date(cached.sunrise), sunset: new Date(cached.sunset) };
  }
  let coords;
  try { const p = await geo.current(); coords = { lat: p.lat, lon: p.lon }; }
  catch (_) { const c = await db.get('cache', 'weatherCoords').catch(() => null); coords = (c && c.value) || { lat: -33.61, lon: -70.58 }; }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('sin conexión');
  const d = await res.json();
  const sr = d.daily.sunrise[0], ss = d.daily.sunset[0]; // hora local (timezone=auto)
  await db.put('cache', { key: 'sun', day: today, sunrise: sr, sunset: ss }).catch(() => {});
  return { sunrise: new Date(sr), sunset: new Date(ss) };
}
