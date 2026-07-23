/* ============================================================
   INFOVIP · Helpers de UI (sin framework)
   Creación de elementos, hojas inferiores (bottom sheets),
   toasts y utilidades de plantilla.
   ============================================================ */

// Crea un elemento con atributos e hijos. h('div',{class:'x'}, 'texto')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// Escapa texto para innerHTML seguro
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Toast breve
let snackTimer;
export function toast(msg, ms = 2200) {
  document.querySelectorAll('.snack').forEach((n) => n.remove());
  const s = h('div', { class: 'snack' }, msg);
  document.body.appendChild(s);
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => s.remove(), ms);
}

// Hoja inferior (bottom sheet). Devuelve API {close}.
export function sheet(titleText, buildBody, subText) {
  const body = h('div');
  const panel = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-grab' }),
    titleText ? h('h2', {}, titleText) : null,
    subText ? h('p', { class: 'sheet-sub' }, subText) : null,
    body
  );
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });
  const api = {
    el: panel, body,
    close() { backdrop.style.animation = 'fade .18s reverse'; setTimeout(() => backdrop.remove(), 150); }
  };
  document.body.appendChild(backdrop);
  buildBody(body, api);
  return api;
}

// Confirmación simple
export function confirmSheet(title, message, { okText = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    sheet(title, (body, api) => {
      body.appendChild(h('p', { class: 'muted', style: 'margin:0 0 18px' }, message));
      body.appendChild(h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onClick: () => { api.close(); resolve(false); } }, 'Cancelar'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onClick: () => { api.close(); resolve(true); } }, okText)
      ));
    });
  });
}

// Pide un PIN numérico. Devuelve el string o null si cancela.
export function askPin(title = 'Ingresa el PIN', sub = '') {
  return new Promise((resolve) => {
    sheet(title, (body, api) => {
      const input = h('input', { class: 'input big center', type: 'password', inputmode: 'numeric', maxlength: '8', placeholder: '••••' });
      body.appendChild(h('div', { class: 'field' }, input));
      body.appendChild(h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onClick: () => { api.close(); resolve(null); } }, 'Cancelar'),
        h('button', { class: 'btn primary', onClick: () => { const v = input.value.trim(); api.close(); resolve(v || null); } }, 'Aceptar')
      ));
      setTimeout(() => input.focus(), 120);
    }, sub);
  });
}

export function emptyState(icon, text) {
  return h('div', { class: 'empty' }, h('div', { class: 'em-ico' }, icon), h('p', {}, text));
}

export function fmtTime(ts) {
  try { return new Date(ts).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }); }
  catch (_) { return ''; }
}
