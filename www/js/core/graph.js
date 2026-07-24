/* ============================================================
   INFOVIP · Cliente Microsoft Graph para SharePoint
   Resuelve el sitio/biblioteca/carpeta de EEPA, encuentra el
   Excel que corresponde al número de sello (por su rango en el
   nombre) y escribe la fila del sello con la API Workbook.
   No descarga el archivo: escribe la celda directo en SharePoint,
   se guarda solo y respeta la co-edición (sale a nombre del usuario).
   ============================================================ */
import { prefs } from './store.js';
import { getAccessToken } from './msauth.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Configuración de la carpeta y el mapeo de columnas (editable en Ajustes).
export const DEFAULT_SP = {
  siteHostname: 'eepachile.sharepoint.com',
  sitePath: '/sites/Operaciones.EEPA',
  folderPath: 'CENTRO DE CONTROL/Registro de Sellos',
  worksheet: 'Rendición de Sellos',
  firstDataRow: 6,          // los sellos empiezan en la fila 6
  sealColumn: 'B',          // columna con el N° de sello
  // Columnas que llena el usuario (las auto: G medidor, H dirección, se omiten)
  columns: {
    rol: 'F', color: 'C', cargo: 'D', condicion: 'E', posicion: 'I',
    retiroNum: 'J', retiroColor: 'K', otc: 'L', fecha: 'M', motivo: 'N'
  }
};
export function spConfig() { return { ...DEFAULT_SP, ...(prefs.get('spConfig', {}) || {}) }; }

async function api(path, opts = {}) {
  const token = await getAccessToken();
  if (!token) { const e = new Error('NO_AUTH'); e.code = 'NO_AUTH'; throw e; }
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  if (!res.ok) {
    const txt = await res.text();
    const e = new Error(`Graph ${res.status}: ${txt.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

/* ---------- Resolución de sitio / drive (cacheado) ---------- */
let _ctx = null;
async function context() {
  if (_ctx) return _ctx;
  const c = spConfig();
  const site = await api(`/sites/${c.siteHostname}:${c.sitePath}`);
  const drive = await api(`/sites/${site.id}/drive`); // "Documentos compartidos"
  _ctx = { siteId: site.id, driveId: drive.id };
  return _ctx;
}
export function resetContext() { _ctx = null; }

/* ---------- Listar Excel de la carpeta ---------- */
export async function listSealFiles() {
  const { driveId } = await context();
  const folder = encodeURIComponent(spConfig().folderPath);
  const data = await api(`/drives/${driveId}/root:/${folder}:/children?$select=id,name,file&$top=200`);
  return (data.value || []).filter((it) => it.file && /\.xlsx?$/i.test(it.name));
}

// Extrae el rango [inicio,fin] del nombre "15801_al_15850.xlsx"
export function parseRange(name) {
  const m = name.match(/(\d{3,})\D+(\d{3,})/);
  if (!m) return null;
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

// Encuentra el archivo cuyo rango contiene el número de sello.
export async function findFileForSeal(seal) {
  const n = parseInt(String(seal).replace(/\D/g, ''), 10);
  const files = await listSealFiles();
  for (const f of files) {
    const r = parseRange(f.name);
    if (r && n >= r.start && n <= r.end) return { item: f, range: r };
  }
  return null;
}

/* ---------- Ubicar la fila del sello dentro del Excel ---------- */
export async function findSealRow(itemId, seal, range) {
  const c = spConfig();
  const n = parseInt(String(seal).replace(/\D/g, ''), 10);
  const ws = encodeURIComponent(c.worksheet);
  const lastRow = c.firstDataRow + (range ? (range.end - range.start) : 200);
  const addr = `${c.sealColumn}${c.firstDataRow}:${c.sealColumn}${lastRow}`;
  const { driveId } = await context();
  const rng = await api(`/drives/${driveId}/items/${itemId}/workbook/worksheets('${ws}')/range(address='${addr}')?$select=values`);
  const values = rng.values || [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i][0];
    if (v != null && parseInt(String(v).replace(/\D/g, ''), 10) === n) return c.firstDataRow + i;
  }
  // Respaldo aritmético (los N° son correlativos)
  if (range) return c.firstDataRow + (n - range.start);
  return null;
}

/* ---------- Escribir una celda ---------- */
async function writeCell(itemId, col, row, value) {
  if (value == null || value === '') return;
  const c = spConfig();
  const ws = encodeURIComponent(c.worksheet);
  const addr = `${col}${row}`;
  const { driveId } = await context();
  await api(`/drives/${driveId}/items/${itemId}/workbook/worksheets('${ws}')/range(address='${addr}')`, {
    method: 'PATCH', body: JSON.stringify({ values: [[value]] })
  });
}

/* ---------- Ubicar un sello (archivo + fila) ---------- */
export async function locateSeal(seal) {
  const found = await findFileForSeal(seal);
  if (!found) throw new Error(`Ningún Excel de la carpeta cubre el sello ${seal}`);
  const row = await findSealRow(found.item.id, seal, found.range);
  if (!row) throw new Error(`No se encontró la fila del sello ${seal}`);
  return { itemId: found.item.id, file: found.item.name, row };
}

// Lee el CARGO ya escrito en la fila de un sello (para autocompletar).
export async function readCargo(seal) {
  try {
    const loc = await locateSeal(seal);
    const c = spConfig();
    const ws = encodeURIComponent(c.worksheet);
    const { driveId } = await context();
    const rng = await api(`/drives/${driveId}/items/${loc.itemId}/workbook/worksheets('${ws}')/range(address='${c.columns.cargo}${loc.row}')?$select=values`);
    const v = rng.values && rng.values[0] && rng.values[0][0];
    return { cargo: v ? String(v).trim() : '', loc };
  } catch (_) { return { cargo: '', loc: null }; }
}

// Escribe una fila (un sello) con los campos dados. color = siempre CAFÉ.
async function writeRow(itemId, row, d) {
  const cols = spConfig().columns;
  const map = [
    [cols.rol, d.rol], [cols.color, 'CAFÉ'], [cols.cargo, d.cargo],
    [cols.condicion, d.condicion], [cols.posicion, d.posicion],
    [cols.retiroNum, d.retiroNum], [cols.retiroColor, d.retiroColor],
    [cols.otc, d.otc], [cols.fecha, d.fecha], [cols.motivo, d.motivo]
  ];
  for (const [col, val] of map) { if (col && val != null && val !== '') await writeCell(itemId, col, row, val); }
}

/* ---------- Rendir uno o varios sellos ----------
   base    = { rol, cargo, condicion, otc, motivo, fecha }  (datos compartidos)
   entries = [ { seal, posicion, retiroNum, retiroColor }, ... ] (uno por fila)
   Todos comparten dirección/OTC/motivo; cambian posición y sello retirado. */
export async function rendir(base, entries, onStep) {
  const step = (m) => onStep && onStep(m);
  const done = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    step(`Sello ${e.seal}: buscando archivo…`);
    const loc = await locateSeal(e.seal);
    step(`Sello ${e.seal}: escribiendo en ${loc.file} fila ${loc.row}…`);
    await writeRow(loc.itemId, loc.row, { ...base, ...e });
    done.push({ seal: e.seal, file: loc.file, row: loc.row });
  }
  step('Guardado en SharePoint ✓');
  return done;
}

/* ---------- Verificación de conexión ---------- */
export async function whoAmI() { return api('/me?$select=displayName,userPrincipalName'); }
