/* ============================================================
   INFOVIP · Módulo 1 · PLANILLA SELLOS (local)
   Buscador rápido por ROL sobre IndexedDB. Muestra DIRECCIÓN y
   MEDIDOR al instante. Permite importar la planilla (JSON/CSV)
   una sola vez; queda cacheada en el dispositivo.
   ============================================================ */
import { h, clear, toast, emptyState, esc } from '../core/ui.js';
import { register } from '../core/router.js';
import { db } from '../core/db.js';
import { prefs } from '../core/store.js';

let INDEX = [];   // copia en memoria para búsqueda instantánea

async function ensureLoaded() {
  const count = await db.count('sellos').catch(() => 0);
  if (count === 0 && !prefs.get('sellosSeeded', false)) {
    // Sembrar datos de muestra la primera vez (offline-first).
    try {
      const res = await fetch('./data/sellos.sample.json');
      const rows = await res.json();
      await db.bulkPut('sellos', normalize(rows));
      prefs.set('sellosSeeded', true);
    } catch (_) {}
  }
  INDEX = await db.getAll('sellos').catch(() => []);
}

function normalize(rows) {
  return rows.map((r) => ({
    rol: String(r.rol ?? r.ROL ?? '').trim(),
    direccion: String(r.direccion ?? r.DIRECCION ?? r['DIRECCIÓN'] ?? '').trim(),
    medidor: String(r.medidor ?? r.MEDIDOR ?? '').trim()
  })).filter((r) => r.rol);
}

function search(q) {
  const term = q.trim().toLowerCase().replace(/\s+/g, '');
  if (!term) return [];
  return INDEX.filter((r) =>
    r.rol.toLowerCase().replace(/\s+/g, '').includes(term)
  ).slice(0, 30);
}

async function render(root) {
  clear(root);
  await ensureLoaded();

  root.appendChild(h('div', { class: 'page-title' }, 'Planilla Sellos'));
  root.appendChild(h('div', { class: 'page-sub' }, `${INDEX.length} registros locales · busca por ROL`));

  const input = h('input', { class: 'input', type: 'search', inputmode: 'numeric', placeholder: 'Escribe el ROL…', autocomplete: 'off' });
  const bar = h('div', { class: 'searchbar' }, input);
  root.appendChild(bar);

  const results = h('div', { id: 'sellos-results' });
  root.appendChild(results);

  const toolbar = h('div', { class: 'btn-row mt' },
    h('button', { class: 'btn ghost sm', onClick: () => openImport(root) }, '⬆️  Importar planilla'),
    h('button', { class: 'btn ghost sm', onClick: () => openAdd(root) }, '➕  Agregar')
  );
  root.appendChild(toolbar);

  const paint = () => {
    clear(results);
    const q = input.value;
    if (!q.trim()) { results.appendChild(emptyState('🔖', 'Ingresa un ROL para ver dirección y medidor.')); return; }
    const rows = search(q);
    if (rows.length === 0) { results.appendChild(emptyState('🔍', 'Sin coincidencias para ese ROL.')); return; }
    rows.forEach((r) => results.appendChild(resultCard(r)));
  };
  input.addEventListener('input', paint);
  paint();
  setTimeout(() => input.focus(), 150);
}

function resultCard(r) {
  return h('div', { class: 'card' },
    h('div', { class: 'row between' },
      h('div', { class: 'chip' }, `ROL ${esc(r.rol)}`),
      h('span', { class: 'muted', style: 'font-size:11px' }, 'sellos')
    ),
    h('div', { class: 'kv', style: 'margin-top:10px' }, h('span', { class: 'k' }, 'Dirección'), h('span', { class: 'v', style: 'text-align:right;max-width:62%' }, r.direccion || '—')),
    h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Medidor'), h('span', { class: 'v' }, r.medidor || '—'))
  );
}

function openImport(root) {
  import('../core/ui.js').then(({ sheet }) => {
    sheet('Importar planilla', (body, api) => {
      body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 14px' }, 'Selecciona un archivo JSON o CSV con columnas ROL, DIRECCIÓN, MEDIDOR. Se guarda solo en este teléfono.'));
      const file = h('input', { class: 'input', type: 'file', accept: '.json,.csv,application/json,text/csv' });
      body.appendChild(h('div', { class: 'field' }, file));
      const replace = h('input', { type: 'checkbox' });
      body.appendChild(h('label', { class: 'row', style: 'gap:8px;margin-bottom:14px' }, replace, h('span', { class: 'muted' }, 'Reemplazar planilla actual')));
      body.appendChild(h('button', { class: 'btn primary', onClick: async () => {
        const f = file.files[0];
        if (!f) return toast('Elige un archivo');
        try {
          const text = await f.text();
          const rows = normalize(f.name.endsWith('.csv') ? parseCSV(text) : JSON.parse(text));
          if (replace.checked) await db.clear('sellos');
          const n = await db.bulkPut('sellos', rows);
          prefs.set('sellosSeeded', true);
          api.close(); toast(`✅ ${n} registros importados`);
          render(root);
        } catch (e) { toast('Archivo inválido'); }
      } }, 'Importar'));
    }, 'Aislado y local.');
  });
}

function openAdd(root) {
  import('../core/ui.js').then(({ sheet }) => {
    sheet('Agregar registro', (body, api) => {
      const rol = h('input', { class: 'input', placeholder: 'ROL' });
      const dir = h('input', { class: 'input', placeholder: 'Dirección' });
      const med = h('input', { class: 'input', placeholder: 'Medidor' });
      [['ROL', rol], ['Dirección', dir], ['Medidor', med]].forEach(([l, el]) =>
        body.appendChild(h('div', { class: 'field' }, h('label', {}, l), el)));
      body.appendChild(h('button', { class: 'btn primary', onClick: async () => {
        if (!rol.value.trim()) return toast('El ROL es obligatorio');
        await db.put('sellos', { rol: rol.value.trim(), direccion: dir.value.trim(), medidor: med.value.trim() });
        api.close(); toast('Guardado'); render(root);
      } }, 'Guardar'));
    });
  });
}

// CSV simple (coma o punto y coma) con encabezado
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map((s) => s.trim().toLowerCase());
  const idx = (names) => head.findIndex((hh) => names.includes(hh));
  const iRol = idx(['rol']), iDir = idx(['direccion', 'dirección', 'direc']), iMed = idx(['medidor', 'med']);
  return lines.slice(1).map((line) => {
    const c = line.split(sep);
    return { rol: c[iRol] || '', direccion: c[iDir] || '', medidor: c[iMed] || '' };
  });
}

register('sellos', { render, title: 'Planilla Sellos' });
