/* ============================================================
   INFOVIP · Panel de CONFIGURACIÓN / personalización de la UI
   - Elegir pestaña de inicio
   - Ocultar / mostrar pestañas
   - Reordenar la barra (drag & drop táctil)
   Se abre como hoja inferior desde el botón ⚙️ del header.
   ============================================================ */
import { h, sheet, toast } from '../core/ui.js';
import { REGISTRY, getOrder, setOrder, getHidden, setHidden, getHome, setHome } from '../core/tabs.js';
import { renderTabbar, go, currentId } from '../core/router.js';

export function openSettings() {
  sheet('Configuración', (body) => {
    // --- Pestaña de inicio ---
    body.appendChild(section('Página de inicio', 'Qué módulo se abre al entrar.'));
    const homeSel = h('select', { class: 'select' });
    for (const t of REGISTRY) homeSel.appendChild(h('option', { value: t.id, ...(getHome() === t.id ? { selected: true } : {}) }, `${t.icon}  ${t.name}`));
    homeSel.addEventListener('change', () => { setHome(homeSel.value); toast('Inicio actualizado'); });
    body.appendChild(h('div', { class: 'field' }, homeSel));

    body.appendChild(h('div', { class: 'divider' }));

    // --- Reordenar + ocultar ---
    body.appendChild(section('Barra de navegación', 'Arrastra para reordenar. Usa el interruptor para ocultar pestañas.'));
    const listWrap = h('div', { id: 'reorder-list' });
    body.appendChild(listWrap);
    renderReorderList(listWrap);

    body.appendChild(h('div', { class: 'divider' }));

    // --- Info app / actualización ---
    body.appendChild(section('Aplicación', 'Datos locales y actualización.'));
    body.appendChild(h('button', { class: 'btn ghost', onClick: () => {
      if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => r && r.update());
      toast('Buscando actualizaciones…');
    } }, '🔄  Buscar actualización'));
    body.appendChild(h('div', { class: 'hint' }, 'Los datos (sellos, audios, planos, automatizaciones) se guardan solo en este teléfono.'));
  }, 'Personaliza INFOVIP a tu gusto.');
}

function section(title, desc) {
  return h('div', { style: 'margin:6px 0 12px' },
    h('div', { class: 'sr-title', style: 'font-size:15px' }, title),
    desc ? h('div', { class: 'sr-desc' }, desc) : null
  );
}

function renderReorderList(wrap) {
  wrap.innerHTML = '';
  const order = getOrder();
  const hidden = getHidden();
  order.forEach((id) => {
    const t = REGISTRY.find((r) => r.id === id);
    if (!t) return;
    const row = h('div', { class: 'reorder-item', 'data-id': id, draggable: 'false' },
      h('span', { class: 'drag-handle' }, '⠿'),
      h('span', { class: 'ri-ico' }, t.icon),
      h('span', { class: 'ri-name' }, t.name),
      toggle(!hidden.has(id), (on) => {
        const hs = getHidden();
        if (on) hs.delete(id); else hs.add(id);
        setHidden(hs);
        renderTabbar();
        toast(on ? `${t.name} visible` : `${t.name} oculta`);
      })
    );
    enableDrag(row, wrap);
    wrap.appendChild(row);
  });
}

function toggle(checked, onChange) {
  const input = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', { class: 'track' }), h('span', { class: 'thumb' }));
}

/* ---------- Drag & drop táctil (pointer events) ---------- */
function enableDrag(row, wrap) {
  const handle = row.querySelector('.drag-handle');
  let startY = 0, dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    startY = e.clientY;
    row.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const y = e.clientY;
    const siblings = [...wrap.querySelectorAll('.reorder-item:not(.dragging)')];
    let placed = false;
    for (const sib of siblings) {
      const box = sib.getBoundingClientRect();
      if (y < box.top + box.height / 2) { wrap.insertBefore(row, sib); placed = true; break; }
    }
    if (!placed) wrap.appendChild(row);
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    row.classList.remove('dragging');
    const ids = [...wrap.querySelectorAll('.reorder-item')].map((n) => n.getAttribute('data-id'));
    setOrder(ids);
    renderTabbar();
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
