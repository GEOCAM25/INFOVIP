/* ============================================================
   INFOVIP · Parche del AndroidManifest tras "cap add android"
   Inserta el intent-filter del deep-link "com.infovip.app://auth"
   para que el login de Microsoft (navegador del sistema) regrese
   a la app. La carpeta android/ se regenera en cada build de CI,
   por eso este parche se aplica automáticamente en el workflow.
   ============================================================ */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
if (!existsSync(manifestPath)) {
  console.error('[patch-android] No existe', manifestPath, '— ¿corriste "cap add android"?');
  process.exit(0); // no romper el build
}

let xml = readFileSync(manifestPath, 'utf8');
let changed = false;

/* ---- 1) Permisos del teléfono ---- */
const PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION', // ubicación con pantalla apagada
  'android.permission.POST_NOTIFICATIONS',         // notificaciones (Android 13+)
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK'
];
const permLines = PERMISSIONS
  .filter((p) => !xml.includes(`android:name="${p}"`))
  .map((p) => `    <uses-permission android:name="${p}" />`)
  .join('\n');
if (permLines) {
  xml = xml.replace(/<application/, permLines + '\n\n    <application');
  changed = true;
  console.log('[patch-android] Permisos agregados al manifest ✓');
}

/* ---- 2) Deep-link del login Microsoft ---- */
if (xml.includes('com.infovip.app')) {
  if (changed) writeFileSync(manifestPath, xml);
  console.log('[patch-android] Deep-link ya presente.');
  process.exit(0);
}

const intentFilter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.infovip.app" android:host="auth" />
            </intent-filter>
`;

// Insertar dentro de la actividad principal, antes de </activity>.
const idx = xml.indexOf('</activity>');
if (idx === -1) {
  console.error('[patch-android] No se encontró </activity>; no se aplicó el parche.');
  process.exit(0);
}
xml = xml.slice(0, idx) + intentFilter + '        ' + xml.slice(idx);
writeFileSync(manifestPath, xml);
console.log('[patch-android] Deep-link com.infovip.app://auth agregado al manifest ✓');
