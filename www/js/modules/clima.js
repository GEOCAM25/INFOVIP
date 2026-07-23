/* ============================================================
   INFOVIP · Módulo 4 · CLIMA Y SUBESTACIONES (SE)
   Ruta con dos secciones internas: Clima (Open-Meteo con caché
   offline del último registro) y Subestaciones.
   ============================================================ */
import { h, clear, toast, emptyState } from '../core/ui.js';
import { register } from '../core/router.js';
import { db } from '../core/db.js';
import { prefs } from '../core/store.js';
import { geo } from '../core/native.js';
import { renderSE } from './subestaciones.js';

const WMO = {
  0: ['☀️', 'Despejado'], 1: ['🌤️', 'Mayormente despejado'], 2: ['⛅', 'Parcial nublado'], 3: ['☁️', 'Nublado'],
  45: ['🌫️', 'Niebla'], 48: ['🌫️', 'Niebla'], 51: ['🌦️', 'Llovizna'], 53: ['🌦️', 'Llovizna'], 55: ['🌧️', 'Llovizna intensa'],
  61: ['🌧️', 'Lluvia leve'], 63: ['🌧️', 'Lluvia'], 65: ['🌧️', 'Lluvia fuerte'], 71: ['🌨️', 'Nieve'], 73: ['🌨️', 'Nieve'],
  80: ['🌦️', 'Chubascos'], 81: ['🌧️', 'Chubascos'], 82: ['⛈️', 'Chubascos fuertes'], 95: ['⛈️', 'Tormenta'], 96: ['⛈️', 'Tormenta']
};

async function render(root) {
  clear(root);
  let seg = prefs.get('climaSeg', 'clima');

  const nav = h('div', { class: 'row', style: 'gap:8px;margin-bottom:14px' },
    segBtn('🌦️ Clima', 'clima'), segBtn('📡 Subestaciones', 'se'));
  const panel = h('div');
  root.appendChild(nav); root.appendChild(panel);

  function segBtn(label, id) {
    const b = h('button', { class: 'btn ' + (seg === id ? 'primary' : 'ghost') + ' sm', style: 'flex:1' }, label);
    b.addEventListener('click', () => { seg = id; prefs.set('climaSeg', id); repaintNav(); route(); });
    b._id = id; return b;
  }
  function repaintNav() { [...nav.children].forEach((c) => { c.className = 'btn ' + (c._id === seg ? 'primary' : 'ghost') + ' sm'; c.style.flex = '1'; }); }
  function route() { seg === 'se' ? renderSE(panel) : renderClima(panel); }
  route();
}

async function renderClima(panel) {
  clear(panel);
  panel.appendChild(h('div', { class: 'page-title', style: 'font-size:18px' }, 'Clima'));

  const cached = await db.get('cache', 'weather').catch(() => null);
  const box = h('div');
  panel.appendChild(box);

  if (cached) paintWeather(box, cached.value, cached.savedAt, true);
  else box.appendChild(emptyState('🌦️', 'Sin datos aún. Toca actualizar.'));

  panel.appendChild(h('button', { class: 'btn primary mt', onClick: () => refresh(box) }, '📍 Actualizar con mi ubicación'));
  panel.appendChild(h('div', { class: 'hint' }, 'Si no hay señal, se muestra el último registro guardado.'));

  if (!cached && navigator.onLine) refresh(box);
}

async function refresh(box) {
  try {
    let coords;
    try { const p = await geo.current(); coords = { lat: p.lat, lon: p.lon }; }
    catch (_) { coords = prefs.get('lastCoords', { lat: -33.61, lon: -70.58 }); } // Puente Alto por defecto
    prefs.set('lastCoords', coords);

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
                `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
                `&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('red');
    const data = await res.json();
    await db.put('cache', { key: 'weather', value: data, savedAt: Date.now() });
    paintWeather(box, data, Date.now(), false);
    toast('Clima actualizado');
  } catch (_) {
    toast('Sin conexión: mostrando último registro');
    const cached = await db.get('cache', 'weather').catch(() => null);
    if (cached) paintWeather(box, cached.value, cached.savedAt, true);
  }
}

function paintWeather(box, data, savedAt, offline) {
  clear(box);
  const cur = data.current || {};
  const [ico, desc] = WMO[cur.weather_code] || ['🌡️', '—'];
  box.appendChild(h('div', { class: 'card' },
    h('div', { class: 'weather-hero' },
      h('div', { class: 'ico' }, ico),
      h('div', { class: 'temp' }, `${Math.round(cur.temperature_2m ?? 0)}°`),
      h('div', { class: 'cond' }, desc)
    ),
    h('div', { class: 'wx-grid' },
      metric('🌡️ Sensación', `${Math.round(cur.apparent_temperature ?? 0)}°`),
      metric('💧 Humedad', `${cur.relative_humidity_2m ?? '—'}%`),
      metric('💨 Viento', `${Math.round(cur.wind_speed_10m ?? 0)} km/h`),
      metric('🕒 Registro', new Date(savedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }))
    ),
    offline ? h('div', { class: 'chip warn mt' }, '⚠ Datos offline (último guardado)') : h('div', { class: 'chip ok mt' }, '● En línea')
  ));
}

function metric(label, value) {
  return h('div', { class: 'card', style: 'margin:0;text-align:center;padding:12px' },
    h('div', { class: 'muted', style: 'font-size:12px' }, label),
    h('div', { class: 'v', style: 'font-size:20px;margin-top:4px' }, value)
  );
}

register('clima', { render, title: 'Clima y SE' });
