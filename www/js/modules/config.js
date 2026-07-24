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
import { prefs } from '../core/store.js';

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

    // --- SharePoint / Microsoft (rendición de sellos) ---
    body.appendChild(section('SharePoint · Rendición de sellos', 'Conexión con Microsoft para escribir los sellos. Lo habilita IT una sola vez.'));

    const clientId = h('input', { class: 'input', placeholder: 'Client ID (Application ID)', value: prefs.get('msClientId', '') });
    body.appendChild(h('div', { class: 'field' }, h('label', {}, 'Client ID de Microsoft'), clientId));

    const tenant = h('input', { class: 'input', placeholder: 'Directory (tenant) ID o dominio', value: prefs.get('msTenant', '') });
    body.appendChild(h('div', { class: 'field' }, h('label', {}, 'Tenant ID (de tu empresa)'), tenant));

    const sim = h('input', { type: 'checkbox', ...(prefs.get('spSimulate', false) ? { checked: true } : {}) });
    sim.addEventListener('change', () => { prefs.set('spSimulate', sim.checked); toast(sim.checked ? 'Simulación ON' : 'Simulación OFF'); });
    body.appendChild(h('div', { class: 'setting-row' },
      h('div', { class: 'sr-main' }, h('div', { class: 'sr-title' }, '🧪 Modo simulación'), h('div', { class: 'sr-desc' }, 'Prueba el formulario sin escribir en SharePoint.')),
      h('label', { class: 'switch' }, sim, h('span', { class: 'track' }), h('span', { class: 'thumb' }))
    ));

    body.appendChild(h('button', { class: 'btn primary sm', onClick: () => {
      prefs.set('msClientId', clientId.value.trim());
      prefs.set('msTenant', tenant.value.trim());
      toast('Configuración de Microsoft guardada');
    } }, 'Guardar conexión'));
    body.appendChild(h('div', { class: 'hint' }, 'Redirect URIs a registrar en Azure: para el APK usa "com.infovip.app://auth" (Mobile/desktop) y para web tu URL + /redirect.html (SPA).'));

    body.appendChild(h('div', { class: 'divider' }));

    // --- Permisos ---
    body.appendChild(section('Permisos', 'Ubicación y notificaciones para las alarmas.'));
    const permInfo = h('div', { class: 'hint', style: 'margin-bottom:10px' }, 'Revisando…');
    body.appendChild(permInfo);
    import('../core/permissions.js').then(async ({ checkStatus, requestAll, backgroundLocationHint }) => {
      const s = await checkStatus();
      const fmt = (v) => v === 'granted' ? '✅' : v === 'denied' ? '⛔' : '❔';
      permInfo.innerHTML = `📍 Ubicación: ${fmt(s.location)} &nbsp;·&nbsp; 🔔 Notificaciones: ${fmt(s.notifications)}<br><span style="opacity:.8">${backgroundLocationHint()}</span>`;
      body.appendChild(h('button', { class: 'btn ghost sm', onClick: async () => {
        const r = await requestAll();
        toast(r.location === 'granted' ? 'Permisos actualizados' : 'Revisa los ajustes de Android');
        const s2 = await checkStatus();
        permInfo.innerHTML = `📍 Ubicación: ${fmt(s2.location)} &nbsp;·&nbsp; 🔔 Notificaciones: ${fmt(s2.notifications)}`;
      } }, '🔓  Solicitar permisos'));
    });

    body.appendChild(h('div', { class: 'divider' }));

    // --- Info app / actualización ---
    body.appendChild(section('Aplicación', 'Datos locales y actualización.'));
    const updBtn = h('button', { class: 'btn ghost', onClick: async () => {
      updBtn.textContent = 'Buscando…';
      try {
        const { checkUpdate, showUpdateBanner } = await import('../core/appupdate.js');
        const u = await checkUpdate();
        if (!u || u.error) toast(u && u.error === 'timeout' ? 'Sin respuesta (revisa internet)' : 'No se pudo consultar (' + ((u && u.error) || 'red') + ')');
        else if (u.upToDate) toast(`✅ Estás al día (build-${u.current})`);
        else { showUpdateBanner(u); toast(`Disponible build-${u.build} · toca “Actualizar app”`); }
      } catch (e) { toast('Error al buscar actualización'); }
      finally { updBtn.textContent = '🔄  Buscar actualización'; }
    } }, '🔄  Buscar actualización');
    body.appendChild(updBtn);
    import('../core/appupdate.js').then(async ({ currentBuild }) => {
      const b = await currentBuild();
      body.appendChild(h('div', { class: 'hint' }, `Versión instalada: build-${b}. Las actualizaciones se instalan encima (misma firma), sin desinstalar.`));
    });
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
