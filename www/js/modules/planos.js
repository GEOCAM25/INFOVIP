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
import { prefs } from '../core/store.js';

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

/* ---------------- Visor a pantalla completa con zoom por gestos ---------------- */
async function openViewer(plano) {
  let dark = true, doc = null;

  // Overlay a pantalla completa
  const info = h('span', { class: 'pdfv-info' }, 'Cargando…');
  const btnLayers = h('button', { class: 'pdfv-btn', title: 'Capas', hidden: true }, '🗂');
  const btnDark = h('button', { class: 'pdfv-btn', title: 'Modo lectura' }, '🌓');
  const btnReset = h('button', { class: 'pdfv-btn', title: 'Ajustar' }, '⤢');
  const btnClose = h('button', { class: 'pdfv-btn', title: 'Cerrar' }, '✕');
  const bar = h('div', { class: 'pdfv-bar' },
    h('span', { class: 'pdfv-title' }, esc(plano.name)), info,
    h('div', { class: 'pdfv-actions' }, btnLayers, btnDark, btnReset, btnClose));
  const layer = h('div', { class: 'pdfv-layer' });
  const stage = h('div', { class: 'pdfv-stage' }, layer);
  const overlay = h('div', { class: 'pdfv-overlay' }, bar, stage);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  btnClose.addEventListener('click', close);

  // Estado de zoom/paneo (transform sobre 'layer', sin re-renderizar → sin crash)
  let scale = 1, minScale = 1, tx = 0, ty = 0;
  const apply = () => { layer.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  function fit() {
    // Centrar horizontalmente al ancho del stage
    const sw = stage.clientWidth, lw = layer.scrollWidth || sw;
    scale = 1; minScale = 1; tx = Math.max(0, (sw - lw) / 2); ty = 0; apply();
  }
  btnReset.addEventListener('click', fit);

  function applyDark() {
    layer.querySelectorAll('canvas').forEach((c) => {
      c.style.filter = dark ? 'invert(1) hue-rotate(180deg) brightness(.92) contrast(1.05)' : 'none';
    });
    stage.style.background = dark ? '#0a1526' : '#eef2f8';
    btnDark.classList.toggle('on', dark);
  }
  btnDark.addEventListener('click', () => { dark = !dark; applyDark(); });

  /* ---- Gestos: pellizco (pinch) para zoom, un dedo para paneo, doble toque para ajustar ---- */
  const pts = new Map();
  let startDist = 0, startScale = 1, startMid = null, startTx = 0, startTy = 0, lastTap = 0;
  const dist = (a, b) => Math.hypot(a.x - b.x, b.y - a.y);
  const rect = () => stage.getBoundingClientRect();

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [p1, p2] = [...pts.values()];
      startDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      startScale = scale;
      const r = rect();
      startMid = { x: (p1.x + p2.x) / 2 - r.left, y: (p1.y + p2.y) / 2 - r.top };
      startTx = tx; startTy = ty;
    } else if (pts.size === 1) {
      startTx = tx; startTy = ty;
      const now = Date.now();
      if (now - lastTap < 280) { // doble toque
        if (scale > minScale + 0.05) fit();
        else { scale = 2.4; const r = rect(); tx = (r.width / 2) - (e.clientX - r.left - tx) / startScale * scale; apply(); }
      }
      lastTap = now;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, cur);
    if (pts.size === 2) {
      const arr = [...pts.values()];
      const d = Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
      const ns = Math.min(6, Math.max(minScale, startScale * (d / (startDist || d))));
      tx = startMid.x - (startMid.x - startTx) * (ns / startScale);
      ty = startMid.y - (startMid.y - startTy) * (ns / startScale);
      scale = ns; apply();
    } else if (pts.size === 1) {
      // paneo: delta respecto de la posición previa de este dedo
      tx += cur.x - prev.x; ty += cur.y - prev.y; apply();
    }
  });

  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) { startDist = 0; scheduleQuality(); } };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  // Rueda del mouse (para pruebas en escritorio)
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = rect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    const ns = Math.min(6, Math.max(minScale, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
    tx = mx - (mx - tx) * (ns / scale); ty = my - (my - ty) * (ns / scale);
    scale = ns; apply(); scheduleQuality();
  }, { passive: false });

  // Estado de capas (OCG) + calidad adaptativa
  const pages = [];
  let ocConfig = null;
  let rendering = false;
  let infoBase = '';
  const lockKey = 'planoLocks:' + (plano.id ?? plano.name);

  // Calidad: buena resolución base + MÁS resolución al hacer zoom (re-render
  // nítido). No forzamos baja calidad en gama baja; solo limitamos el máximo.
  const mem = navigator.deviceMemory || 4;
  const lowEnd = mem <= 2;
  const basePR = Math.min(window.devicePixelRatio || 1, lowEnd ? 2 : 3); // nitidez base
  const MAX_CANVAS = lowEnd ? 3200 : 6000;                               // tope px por lado
  let currentPR = basePR, qTimer = null;

  async function renderEntry(entry, pr) {
    const scaleR = (entry.cssWidth * pr) / entry.base.width;
    const vp = entry.page.getViewport({ scale: scaleR });
    entry.canvas.width = Math.round(vp.width);
    entry.canvas.height = Math.round(vp.height);
    entry.canvas.style.width = entry.cssWidth + 'px';
    entry.canvas.style.height = 'auto';
    const params = { canvasContext: entry.canvas.getContext('2d', { alpha: false }), viewport: vp };
    if (ocConfig) params.optionalContentConfigPromise = Promise.resolve(ocConfig);
    await entry.page.render(params).promise;
  }
  async function renderAll(pr = currentPR) {
    if (rendering) return; rendering = true;
    try { for (const e of pages) await renderEntry(e, pr); } finally { rendering = false; }
    applyDark();
  }
  // Al soltar el zoom, re-renderiza más nítido si hace falta (debounce).
  function scheduleQuality() {
    clearTimeout(qTimer);
    qTimer = setTimeout(async () => {
      if (!pages[0]) return;
      const maxPR = MAX_CANVAS / pages[0].cssWidth;
      const desired = Math.max(basePR, Math.min(basePR * scale, maxPR));
      if (desired > currentPR * 1.15 && !rendering) {
        currentPR = desired; info.textContent = 'Mejorando calidad…';
        await renderAll(currentPR); info.textContent = infoBase;
      }
    }, 240);
  }

  // Render inicial
  try {
    const lib = await loadPdfJs();
    const buf = await plano.blob.arrayBuffer();
    doc = await lib.getDocument({ data: buf }).promise;
    ocConfig = await doc.getOptionalContentConfig().catch(() => null);
    const targetCss = stage.clientWidth - 8;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const canvas = h('canvas');
      layer.appendChild(canvas);
      const entry = { page, canvas, base, cssWidth: targetCss };
      pages.push(entry);
      await renderEntry(entry, basePR);
      info.textContent = `Página ${n}/${doc.numPages}`;
    }
    infoBase = `${doc.numPages} pág.`;
    info.textContent = infoBase;
    applyDark(); fit();

    // Detectar capas y aplicar candados guardados
    const groups = ocConfig && ocConfig.getGroups ? ocConfig.getGroups() : null;
    const ids = groups ? Object.keys(groups) : [];
    if (ids.length) {
      const locked = new Set((prefs.get(lockKey, []) || []).filter((id) => ids.includes(id)));
      btnLayers.hidden = false;
      infoBase = `${doc.numPages} pág. · ${ids.length} capas`;
      info.textContent = infoBase;
      btnLayers.addEventListener('click', () => openLayers(groups, ids, locked, () => renderAll()));
    }
  } catch (e) {
    layer.appendChild(emptyState('⚠️', 'No se pudo renderizar el PDF.'));
    console.error(e);
  }

  /* ---- Panel de capas: fijar (candado) + aislar al tocar ---- */
  function openLayers(groups, ids, locked, repaint) {
    sheet('Capas del plano', (body) => {
      body.appendChild(h('div', { class: 'btn-row', style: 'margin-bottom:12px' },
        h('button', { class: 'btn ghost sm', onClick: () => { ids.forEach((id) => ocConfig.setVisibility(id, true)); repaint(); refresh(); toast('Todas visibles'); } }, '👁  Mostrar todas')));
      const listWrap = h('div');
      body.appendChild(listWrap);
      function refresh() {
        listWrap.innerHTML = '';
        ids.forEach((id) => {
          const name = (groups[id] && groups[id].name) || id;
          const isLocked = locked.has(id);
          const vis = ocConfig.isVisible(id);
          const lockBtn = h('button', { class: 'btn ' + (isLocked ? 'primary' : 'ghost') + ' sm', style: 'width:auto' }, isLocked ? '🔒 Fijada' : '🔓 Fijar');
          lockBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (locked.has(id)) locked.delete(id);
            else { locked.add(id); ocConfig.setVisibility(id, true); }
            prefs.set(lockKey, [...locked]); repaint(); refresh();
          });
          const row = h('div', { class: 'reorder-item', style: 'touch-action:auto;cursor:pointer' },
            h('span', { class: 'ri-ico' }, isLocked ? '🔒' : (vis ? '👁' : '🚫')),
            h('span', { class: 'ri-name', style: vis ? '' : 'opacity:.45' }, esc(name)),
            lockBtn);
          // Tocar la fila = aislar esa capa (+ las fijadas)
          row.addEventListener('click', () => { ids.forEach((x) => ocConfig.setVisibility(x, x === id || locked.has(x))); repaint(); refresh(); toast('Solo: ' + name); });
          listWrap.appendChild(row);
        });
      }
      refresh();
      body.appendChild(h('div', { class: 'hint', style: 'margin-top:12px' }, 'Toca una capa para ver SOLO esa (más las fijadas). “Fijar” 🔒 mantiene una capa siempre visible aunque aísles otras.'));
    }, `${ids.length} capas`);
  }
}

register('planos', { render, title: 'Visor de Planos' });
