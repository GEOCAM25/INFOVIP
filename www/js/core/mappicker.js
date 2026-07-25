/* ============================================================
   INFOVIP · Selector de área en el mapa (Leaflet)
   Abre un mapa donde el administrador toca para poner el centro,
   ajusta el radio con un deslizador y ve el círculo del área. Los
   tiles del mapa se cargan de internet (OpenStreetMap); si no hay
   señal o falla Leaflet, cae a un modo simple con "usar mi ubicación"
   + radio. Devuelve { lat, lon, radius } o null.
   ============================================================ */
import { h, sheet, toast } from './ui.js';
import { geo } from './native.js';

let _loaded = null;
function loadLeaflet() {
  if (_loaded) return _loaded;
  _loaded = new Promise((resolve) => {
    if (window.L) return resolve(true);
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = './vendor/leaflet.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = './vendor/leaflet.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return _loaded;
}

// initial: { lat, lon, radius } opcional.
export function pickArea(initial = {}) {
  return new Promise((resolve) => {
    const start = {
      lat: initial.lat != null ? initial.lat : -33.6110, // Puente Alto aprox.
      lon: initial.lon != null ? initial.lon : -70.5760,
      radius: initial.radius || 6000
    };
    let center = { lat: start.lat, lon: start.lon };
    let radius = start.radius;
    let map = null, circle = null, dot = null, mode = 'map';

    const api = sheet('Definir área permitida', (body) => {
      const mapEl = h('div', { id: 'gf-map', style: 'height:300px;border-radius:12px;overflow:hidden;background:#0c1a33;margin-bottom:10px' });
      const radLabel = h('div', { class: 'hint', style: 'margin:2px 0 6px' }, `Radio: ${Math.round(radius)} m`);
      const rad = h('input', { type: 'range', min: '200', max: '30000', step: '100', value: String(radius), class: 'range' });
      const coord = h('div', { class: 'hint' }, '');
      const paintCoord = () => { coord.textContent = `Centro: ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)}`; };
      paintCoord();

      rad.addEventListener('input', () => {
        radius = Number(rad.value);
        radLabel.textContent = `Radio: ${Math.round(radius)} m`;
        if (circle) circle.setRadius(radius);
      });

      const locBtn = h('button', { class: 'btn ghost sm', onClick: async () => {
        try {
          const p = await geo.current();
          center = { lat: p.lat, lon: p.lon };
          paintCoord();
          if (map) { map.setView([center.lat, center.lon], 14); circle.setLatLng([center.lat, center.lon]); dot.setLatLng([center.lat, center.lon]); }
        } catch (_) { toast('No se pudo obtener tu ubicación'); }
      } }, '📍 Usar mi ubicación');

      body.appendChild(mapEl);
      body.appendChild(locBtn);
      body.appendChild(radLabel);
      body.appendChild(rad);
      body.appendChild(coord);
      body.appendChild(h('div', { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn ghost', onClick: () => { api.close(); resolve(null); } }, 'Cancelar'),
        h('button', { class: 'btn primary', onClick: () => { api.close(); resolve({ lat: center.lat, lon: center.lon, radius: Math.round(radius) }); } }, 'Guardar área')
      ));

      // Montar el mapa (o modo simple si Leaflet/tiles no cargan).
      loadLeaflet().then((ok) => {
        if (!ok || !window.L) {
          mode = 'simple';
          mapEl.replaceChildren(h('div', { style: 'padding:22px;text-align:center;color:var(--text-dim)' },
            'Mapa no disponible sin conexión. Usa 📍 "Usar mi ubicación" y ajusta el radio; el área se guardará igual.'));
          return;
        }
        const L = window.L;
        setTimeout(() => {
          map = L.map(mapEl, { attributionControl: false }).setView([center.lat, center.lon], 13);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
          circle = L.circle([center.lat, center.lon], { radius, color: '#4d8cff', fillColor: '#2f6ad6', fillOpacity: 0.18, weight: 2 }).addTo(map);
          dot = L.circleMarker([center.lat, center.lon], { radius: 6, color: '#cfe2ff', fillColor: '#4d8cff', fillOpacity: 1 }).addTo(map);
          map.on('click', (e) => {
            center = { lat: e.latlng.lat, lon: e.latlng.lng };
            circle.setLatLng(e.latlng); dot.setLatLng(e.latlng); paintCoord();
          });
          setTimeout(() => map.invalidateSize(), 120);
        }, 60);
      });
    }, 'Toca el mapa para el centro y ajusta el radio. Fuera de esta área la app se bloquea.');
  });
}
