/* ============================================================
   INFOVIP · Módulo · SUBESTACIONES (S/E) — pestaña propia
   Reutiliza el formulario de novedades + envío por WhatsApp.
   ============================================================ */
import { clear, h } from '../core/ui.js';
import { register } from '../core/router.js';
import { renderSE } from './subestaciones.js';

function render(root) {
  clear(root);
  root.appendChild(h('div', { class: 'page-title' }, 'Subestaciones'));
  root.appendChild(h('div', { class: 'page-sub' }, 'Novedades por SE y envío al grupo de turno por WhatsApp.'));
  const panel = h('div');
  root.appendChild(panel);
  renderSE(panel);
}

register('se', { render, title: 'Subestaciones' });
