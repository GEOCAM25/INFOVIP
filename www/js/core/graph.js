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

/* ---------- Flujo completo: rendir un sello ---------- */
// data = { seal, rol, color, cargo, condicion, posicion, retiroNum, retiroColor, otc, fecha, motivo }
export async function rendirSello(data, onStep) {
  const step = (m) => onStep && onStep(m);
  step('Buscando el archivo del sello…');
  const found = await findFileForSeal(data.seal);
  if (!found) throw new Error(`Ningún Excel de la carpeta cubre el sello ${data.seal}`);
  step(`Archivo: ${found.item.name}. Ubicando la fila…`);
  const row = await findSealRow(found.item.id, data.seal, found.range);
  if (!row) throw new Error('No se encontró la fila del sello en el archivo');
  step(`Fila ${row}. Escribiendo datos…`);
  const cols = spConfig().columns;
  // Escribimos solo lo que llena el usuario; medidor/dirección se autocompletan por fórmula.
  const map = [
    [cols.rol, data.rol], [cols.color, data.color], [cols.cargo, data.cargo],
    [cols.condicion, data.condicion], [cols.posicion, data.posicion],
    [cols.retiroNum, data.retiroNum], [cols.retiroColor, data.retiroColor],
    [cols.otc, data.otc], [cols.fecha, data.fecha], [cols.motivo, data.motivo]
  ];
  for (const [col, val] of map) { if (col && val) await writeCell(found.item.id, col, row, val); }
  step('Guardado en SharePoint ✓');
  return { file: found.item.name, row };
}

/* ---------- Verificación de conexión ---------- */
export async function whoAmI() { return api('/me?$select=displayName,userPrincipalName'); }
