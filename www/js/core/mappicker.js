/* ============================================================
   INFOVIP · Selector de área en el mapa (Leaflet)
   Dos modos:
     • POLÍGONO (trazar): tocas las esquinas del sector y se dibuja el
       contorno real de la zona. "Deshacer" quita el último punto.
     • CÍRCULO: un centro + radio con deslizador.
   Los tiles se cargan de internet (OpenStreetMap); sin señal cae a un
   modo simple. Devuelve { polygon:[[lat,lon],...] } o { lat,lon,radius }
   o null si se cancela.
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

export function pickArea(initial = {}) {
  return new Promise((resolve) => {
    const isPoly = !!(initial && initial.polygon && initial.polygon.length);
    let mode = isPoly ? 'poligono' : (initial && initial.radius ? 'circulo' : 'poligono');
    const startCenter = isPoly
      ? { lat: initial.polygon[0][0], lon: initial.polygon[0][1] }
      : { lat: initial.lat != null ? initial.lat : -33.6110, lon: initial.lon != null ? initial.lon : -70.5760 };
    let radius = initial.radius || 6000;
    let center = { ...startCenter };
    let points = isPoly ? initial.polygon.map(([la, lo]) => ({ lat: la, lon: lo })) : [];

    let map = null, L = null, circle = null, dot = null, poly = null, verts = [];

    const api = sheet('Definir área permitida', (body) => {
      const tabPoly = h('button', { class: 'btn sm' + (mode === 'poligono' ? ' primary' : ' ghost'), onClick: () => setMode('poligono') }, '✏️ Trazar sector');
      const tabCirc = h('button', { class: 'btn sm' + (mode === 'circulo' ? ' primary' : ' ghost'), onClick: () => setMode('circulo') }, '⭕ Círculo');
      const tabs = h('div', { class: 'btn-row', style: 'margin-bottom:10px' }, tabPoly, tabCirc);

      const mapEl = h('div', { id: 'gf-map', style: 'height:320px;border-radius:12px;overflow:hidden;background:#0c1a33;margin-bottom:10px' });
      const controls = h('div');
      const hint = h('div', { class: 'hint' }, '');

      const paintHint = () => {
        if (mode === 'poligono') hint.textContent = points.length < 3
          ? `Toca las esquinas del sector (${points.length} puntos, faltan ${Math.max(0, 3 - points.length)}).`
          : `Sector con ${points.length} esquinas. Toca para agregar más o "Deshacer".`;
        else hint.textContent = `Centro: ${center.lat.toFixed(5)}, ${center.lon.toFixed(5)} · Radio ${Math.round(radius)} m.`;
      };

      const renderControls = () => {
        controls.replaceChildren();
        if (mode === 'poligono') {
          controls.appendChild(h('div', { class: 'btn-row' },
            h('button', { class: 'btn ghost sm', onClick: () => { if (points.length) { points.pop(); redrawPoly(); paintHint(); } } }, '↩️ Deshacer'),
            h('button', { class: 'btn ghost sm', onClick: () => { points = []; redrawPoly(); paintHint(); } }, '🗑️ Borrar'),
            h('button', { class: 'btn ghost sm', onClick: recenter }, '📍 Mi ubicación')
          ));
        } else {
          const rad = h('input', { type: 'range', min: '200', max: '30000', step: '100', value: String(radius), class: 'range' });
          rad.addEventListener('input', () => { radius = Number(rad.value); if (circle) circle.setRadius(radius); paintHint(); });
          controls.appendChild(h('button', { class: 'btn ghost sm', onClick: recenter }, '📍 Usar mi ubicación'));
          controls.appendChild(rad);
        }
      };

      const setMode = (m) => {
        mode = m;
        tabPoly.className = 'btn sm' + (m === 'poligono' ? ' primary' : ' ghost');
        tabCirc.className = 'btn sm' + (m === 'circulo' ? ' primary' : ' ghost');
        renderControls(); paintHint(); redrawAll();
      };

      body.appendChild(tabs);
      body.appendChild(mapEl);
      body.appendChild(controls);
      body.appendChild(hint);
      body.appendChild(h('div', { class: 'btn-row', style: 'margin-top:14px' },
        h('button', { class: 'btn ghost', onClick: () => { api.close(); resolve(null); } }, 'Cancelar'),
        h('button', { class: 'btn primary', onClick: save }, 'Guardar área')
      ));
      renderControls(); paintHint();

      function save() {
        if (mode === 'poligono') {
          if (points.length < 3) { toast('Marca al menos 3 esquinas'); return; }
          api.close(); resolve({ polygon: points.map((p) => [p.lat, p.lon]) });
        } else {
          api.close(); resolve({ lat: center.lat, lon: center.lon, radius: Math.round(radius) });
        }
      }

      async function recenter() {
        try {
          const p = await geo.current();
          center = { lat: p.lat, lon: p.lon };
          if (map) map.setView([p.lat, p.lon], 14);
          if (mode === 'circulo') redrawAll();
          paintHint();
        } catch (_) { toast('No se pudo obtener tu ubicación'); }
      }

      function redrawPoly() {
        if (!map || !L) return;
        verts.forEach((v) => map.removeLayer(v)); verts = [];
        const latlngs = points.map((p) => [p.lat, p.lon]);
        if (poly) { poly.setLatLngs(latlngs); }
        else { poly = L.polygon(latlngs, { color: '#4d8cff', fillColor: '#2f6ad6', fillOpacity: 0.18, weight: 2 }).addTo(map); }
        points.forEach((p) => { verts.push(L.circleMarker([p.lat, p.lon], { radius: 5, color: '#cfe2ff', fillColor: '#4d8cff', fillOpacity: 1 }).addTo(map)); });
      }
      function redrawCircle() {
        if (!map || !L) return;
        if (circle) { circle.setLatLng([center.lat, center.lon]); circle.setRadius(radius); }
        else { circle = L.circle([center.lat, center.lon], { radius, color: '#4d8cff', fillColor: '#2f6ad6', fillOpacity: 0.18, weight: 2 }).addTo(map); }
        if (dot) dot.setLatLng([center.lat, center.lon]);
        else dot = L.circleMarker([center.lat, center.lon], { radius: 6, color: '#cfe2ff', fillColor: '#4d8cff', fillOpacity: 1 }).addTo(map);
      }
      function clearLayers() {
        if (!map) return;
        [circle, dot, poly, ...verts].forEach((l) => { if (l) map.removeLayer(l); });
        circle = dot = poly = null; verts = [];
      }
      function redrawAll() {
        clearLayers();
        if (mode === 'poligono') redrawPoly(); else redrawCircle();
      }

      loadLeaflet().then((ok) => {
        if (!ok || !window.L) {
          mapEl.replaceChildren(h('div', { style: 'padding:22px;text-align:center;color:var(--text-dim)' },
            'Mapa no disponible sin conexión. Vuelve a intentarlo con internet para trazar el sector.'));
          return;
        }
        L = window.L;
        setTimeout(() => {
          map = L.map(mapEl, { attributionControl: false }).setView([startCenter.lat, startCenter.lon], 13);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
          map.on('click', (e) => {
            if (mode === 'poligono') { points.push({ lat: e.latlng.lat, lon: e.latlng.lng }); redrawPoly(); paintHint(); }
            else { center = { lat: e.latlng.lat, lon: e.latlng.lng }; redrawCircle(); paintHint(); }
          });
          redrawAll();
          setTimeout(() => map.invalidateSize(), 120);
        }, 60);
      });
    }, 'Traza el sector tocando sus esquinas. Fuera de esa área la app se bloquea.');
  });
}
