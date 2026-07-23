/* ============================================================
   INFOVIP · Módulo INICIO (dashboard)
   Accesos rápidos a los módulos visibles + resumen.
   ============================================================ */
import { h, clear } from '../core/ui.js';
import { visibleTabs } from '../core/tabs.js';
import { go, register } from '../core/router.js';
import { db } from '../core/db.js';

async function render(root) {
  clear(root);
  root.appendChild(h('div', { class: 'page-title' }, 'INFOVIP'));
  root.appendChild(h('div', { class: 'page-sub' }, 'Todo tu trabajo, offline y en tu teléfono.'));

  // Resumen rápido
  const [nSellos, nAutos, nPlanos] = await Promise.all([
    db.count('sellos').catch(() => 0),
    db.count('automatizaciones').catch(() => 0),
    db.count('planos').catch(() => 0)
  ]);

  const stats = h('div', { class: 'grid' },
    statCard('🔖', nSellos, 'Sellos'),
    statCard('⚡', nAutos, 'Automatizaciones'),
    statCard('📐', nPlanos, 'Planos'),
    statCard('📶', navigator.onLine ? 'ON' : 'OFF', 'Conexión')
  );
  root.appendChild(stats);

  root.appendChild(h('div', { class: 'divider' }));
  root.appendChild(h('h3', { style: 'margin:0 0 12px;font-size:15px;color:var(--text-dim)' }, 'Accesos'));

  const grid = h('div', { class: 'grid' });
  for (const tab of visibleTabs()) {
    if (tab.id === 'inicio') continue;
    grid.appendChild(
      h('div', { class: 'card tap', onClick: () => go(tab.id) },
        h('div', { style: 'font-size:30px' }, tab.icon),
        h('h3', { style: 'margin:10px 0 2px' }, tab.name),
        h('div', { class: 'muted' }, descOf(tab.id))
      )
    );
  }
  root.appendChild(grid);
}

function statCard(ico, value, label) {
  return h('div', { class: 'card', style: 'text-align:center;margin:0' },
    h('div', { style: 'font-size:22px' }, ico),
    h('div', { class: 'big-num', style: 'font-size:28px;margin:6px 0 2px' }, String(value)),
    h('div', { class: 'muted' }, label)
  );
}
function descOf(id) {
  return {
    sellos: 'Buscar por ROL',
    autos: 'Reglas y alarmas',
    planos: 'Visor PDF',
    clima: 'Clima y subestaciones'
  }[id] || '';
}

register('inicio', { render, title: 'INFOVIP' });
