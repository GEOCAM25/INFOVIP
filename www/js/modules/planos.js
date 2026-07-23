/* ============================================================
   INFOVIP · Módulo 3 · VISOR DE PLANOS PDF
   Renderiza PDFs pesados con pdf.js (vendorizado, offline) sobre
   canvas, página a página, sin congelar la app. Ofrece "Modo
   Oscuro" invirtiendo el canvas para leer sin deslumbrar.
   Los PDFs se guardan localmente en IndexedDB (blobs).
   ============================================================ */
import { h, clear, toast, emptyState, sheet, confirmSheet, esc, fmtTime } from '../core/ui.js';
import { register } from '../core/router.js';
import { db } from '../core/db.js';

let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('../../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

async function render(root) {
  clear(root);
  root.appendChild(h('div', { class: 'page-title' }, 'Visor de Planos'));
  root.appendChild(h('div', { class: 'page-sub' }, 'PDFs guardados en el dispositivo · modo oscuro de lectura.'));

  const list = h('div');
  root.appendChild(list);

  const planos = await db.getAll('planos').catch(() => []);
  if (!planos.length) list.appendChild(emptyState('📐', 'No tienes planos guardados.\nAgrega un PDF con el botón +'));
  else planos.sort((a, b) => b.createdAt - a.createdAt).forEach((p) => list.appendChild(planoItem(p, root)));

  root.appendChild(h('button', { class: 'fab', onClick: () => openAdd(root) }, '+'));
}

function planoItem(p, root) {
  return h('div', { class: 'list-item' },
    h('span', { class: 'li-ico' }, '📄'),
    h('div', { class: 'li-main', onClick: () => openViewer(p) },
      h('div', { class: 'li-title' }, esc(p.name)),
      h('div', { class: 'li-sub' }, `${(p.blob.size / 1024 / 1024).toFixed(1)} MB · ${fmtTime(p.createdAt)}`)
    ),
    h('button', { class: 'btn primary sm', onClick: () => openViewer(p) }, 'Abrir'),
    h('button', { class: 'btn danger sm', onClick: async () => {
      if (await confirmSheet('Eliminar', `¿Borrar "${p.name}"?`, { okText: 'Eliminar', danger: true })) {
        await db.delete('planos', p.id); toast('Eliminado'); render(root);
      }
    } }, '🗑')
  );
}

function openAdd(root) {
  sheet('Agregar plano PDF', (body, api) => {
    body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'El PDF se guarda solo en este teléfono. No se sube a ningún servidor.'));
    const file = h('input', { class: 'input', type: 'file', accept: 'application/pdf,.pdf' });
    body.appendChild(h('div', { class: 'field' }, file));
    body.appendChild(h('button', { class: 'btn primary', onClick: async () => {
      const f = file.files[0];
      if (!f) return toast('Elige un PDF');
      await db.add('planos', { name: f.name.replace(/\.pdf$/i, ''), blob: f, createdAt: Date.now() });
      api.close(); toast('Plano guardado'); render(root);
    } }, 'Guardar'));
  });
}

/* ---------------- Visor ---------------- */
async function openViewer(plano) {
  const view = sheet(plano.name, () => {}, 'Cargando…');
  const body = view.body;
  let dark = true, scale = 1.15, doc = null;

  const stage = h('div', { class: 'pdf-stage' });
  const info = h('span', { class: 'muted', style: 'font-size:12px' }, 'Renderizando…');
  const toolbar = h('div', { class: 'pdf-toolbar' },
    h('button', { class: 'btn ghost sm', onClick: () => { dark = !dark; applyDark(); } }, '🌓 Modo lectura'),
    h('button', { class: 'btn ghost sm', onClick: () => { scale = Math.min(3, scale + 0.25); repaint(); } }, '➕'),
    h('button', { class: 'btn ghost sm', onClick: () => { scale = Math.max(0.5, scale - 0.25); repaint(); } }, '➖'),
    info
  );
  body.appendChild(toolbar);
  body.appendChild(stage);

  function applyDark() {
    // Filtro CSS inteligente: invierte + rota matiz para conservar colores
    // pero pasar el fondo blanco a oscuro. Muy fluido (GPU).
    stage.querySelectorAll('canvas').forEach((c) => {
      c.style.filter = dark ? 'invert(1) hue-rotate(180deg) brightness(.92) contrast(1.05)' : 'none';
    });
    stage.style.background = dark ? '#0a1526' : '#e9edf4';
  }

  async function repaint() {
    if (!doc) return;
    clear(stage);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: scale * (window.devicePixelRatio > 1 ? 1.3 : 1) });
      const canvas = h('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      canvas.style.width = (viewport.width / (window.devicePixelRatio > 1 ? 1.3 : 1) / scale * scale) + 'px';
      stage.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      info.textContent = `Página ${n}/${doc.numPages}`;
    }
    applyDark();
    info.textContent = `${doc.numPages} página(s)`;
  }

  try {
    const lib = await loadPdfJs();
    const buf = await plano.blob.arrayBuffer();
    doc = await lib.getDocument({ data: buf }).promise;
    await repaint();
  } catch (e) {
    clear(stage);
    stage.appendChild(emptyState('⚠️', 'No se pudo renderizar el PDF.'));
    console.error(e);
  }
}

register('planos', { render, title: 'Visor de Planos' });
