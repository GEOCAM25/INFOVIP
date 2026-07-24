# INFOVIP

Suite operativa **100% offline-first** empaquetada con **Capacitor** para Android.
Toda la información —sellos, audios, PDFs, automatizaciones y configuraciones—
vive **exclusivamente en el teléfono de cada usuario** (IndexedDB + localStorage).
Lo que hace un usuario es individual y no se refleja en los demás.

<p align="center">
  <img src="www/assets/icons/logo.png" width="140" alt="INFOVIP" />
</p>

## ✨ Características

- **Offline-first real**: la app arranca y funciona sin red. El Service Worker
  cachea todo el _app-shell_.
- **Auto-actualización sin Play Store**: cuando se publica una versión nueva en
  GitHub, la app la detecta, la descarga en segundo plano y ofrece aplicarla.
- **Diseño azul metalizado**, modo oscuro nativo, moderno y minimalista.
- **Personalización extrema de la interfaz**: elige la pestaña de inicio, oculta
  pestañas y reordénalas con _drag & drop_.

## 🧩 Módulos

| Módulo | Qué hace |
|--------|----------|
| **Planilla Sellos** | Buscador instantáneo por **ROL** sobre IndexedDB → muestra **Dirección** y **Medidor**. Importa JSON/CSV. |
| **Automatizaciones y Alarmas** | Motor **SI/ENTONCES** con **GPS (radio en metros)** + **batería**, salida de **audio con volumen** y **vibración**, **bloqueo por PIN cifrado** (PBKDF2) y **conversor video→audio** (Web Audio API, sin servidor). |
| **Visor de Planos PDF** | Renderiza PDFs pesados con **pdf.js** (vendorizado, offline) y **modo oscuro** de lectura por filtro de canvas. |
| **Clima y Subestaciones** | Clima vía **Open-Meteo** con **caché offline**; SE (Puente Alto, Pintana, Bajos de Mena, Costanera) con formulario que formatea y abre **WhatsApp**. |

## 🏗️ Arquitectura

```
INFOVIP/
├── www/                      # App web (webDir de Capacitor, servible como PWA)
│   ├── index.html            # Shell
│   ├── manifest.webmanifest  # PWA / instalable
│   ├── service-worker.js     # Offline-first + auto-update
│   ├── css/                  # theme.css (sistema "azul metalizado") + components.css
│   ├── data/                 # sellos.sample.json (semilla local)
│   ├── vendor/               # pdf.js (offline)
│   └── js/
│       ├── app.js            # Bootstrap
│       ├── core/             # db(IndexedDB) · store · router · tabs · ui · update · native · crypto · audioTools
│       └── modules/          # inicio · sellos · automatizaciones · engine · planos · clima · subestaciones · config
├── capacitor.config.json     # appId com.infovip.app · webDir www
├── package.json              # Plugins Capacitor (geolocation, device, haptics)
├── scripts/stamp-version.mjs # Sella versión del SW en cada build
└── .github/workflows/build-apk.yml  # CI: compila el APK y publica release
```

**Decisión de diseño:** app en _Vanilla JS (ES Modules)_ sin framework pesado →
arranque ultrafluido y un `www/` que Capacitor copia directo, sin paso de
_bundling_ frágil (build de APK confiable). El hardware nativo entra por plugins
de Capacitor y degrada a Web APIs en el navegador.

### Aislamiento de datos

Nada sale del dispositivo. IndexedDB guarda sellos, automatizaciones, audios
(blobs), planos (blobs) y borradores; localStorage guarda preferencias. El PIN
se almacena **solo como hash** (PBKDF2-SHA256 con salt). El clima usa una API
pública de solo lectura; el conversor de audio trabaja **en el teléfono**.

## 📱 Compilar el APK

### Automático (recomendado)
Cada push a `main`/`master` dispara el workflow **Build INFOVIP APK**:
compila y publica el `.apk` en la pestaña **Releases** y como artefacto.
También se puede lanzar a mano desde **Actions → Build INFOVIP APK → Run workflow**.

### Local
```bash
npm install
npx cap add android      # primera vez
npm run android:build    # genera android/app/build/outputs/apk/debug/app-debug.apk
```

## 🌐 Probar como web/PWA
```bash
npm run serve            # http://localhost:5173
```

## 🧾 Rendición de sellos → escribir en SharePoint (Microsoft Graph)

El módulo **Rendir** permite llenar lo mínimo de un sello y que la app **escriba
sola** en el Excel correcto dentro de la carpeta de SharePoint. La app:

1. Detecta el archivo por el rango del nombre (`15801_al_15850.xlsx`).
2. Ubica la fila del sello (por su N°).
3. Escribe ROL, color, cargo, condición y posición. **Medidor y dirección se
   autocompletan** por la fórmula VLOOKUP del propio Excel.
4. SharePoint guarda automáticamente (co-edición; el cambio sale a nombre del
   usuario conectado).

Carpeta configurada por defecto (editable en Ajustes → SharePoint):
`eepachile.sharepoint.com/sites/Operaciones.EEPA` → `Documentos compartidos` →
`CENTRO DE CONTROL/Registro de Sellos`.

### Habilitación única en Azure/Entra (la hace un usuario con permiso o IT)

1. Entra a **https://entra.microsoft.com** → **Registros de aplicaciones** → **Nuevo registro**.
   - Nombre: `INFOVIP`. Cuentas: *Solo este directorio organizativo*.
2. En **Autenticación → Agregar plataforma**:
   - **Aplicaciones móviles y de escritorio** → URI de redirección personalizado: `com.infovip.app://auth`
   - **Aplicación de página única (SPA)** → agrega tu URL web + `/redirect.html` (para probar en navegador).
3. En **Permisos de API → Microsoft Graph → Delegados**: agrega **`Sites.ReadWrite.All`**
   (y `offline_access`, `openid`, `profile`) → **Conceder consentimiento de administrador**.
4. Copia el **Application (client) ID** y el **Directory (tenant) ID**.
5. En la app: **Ajustes → SharePoint** → pega ambos → **Guardar** → en **Rendir** toca **Conectar Microsoft**.

> Sin este registro, la app funciona en **modo simulación** (valida y muestra en
> qué archivo/fila escribiría, sin tocar SharePoint). El acceso lo controla
> Microsoft: solo usuarios con permiso podrán escribir.

## 📍 Alarmas en segundo plano (pantalla apagada)

Las automatizaciones por ubicación usan
`@capacitor-community/background-geolocation`, que corre un **servicio en
primer plano** (con notificación persistente "INFOVIP activo") para mantener el
GPS vivo aunque la app esté cerrada o el teléfono bloqueado. El servicio se
enciende **solo si hay alguna alarma activa con condición de ubicación** y se
apaga cuando no. Al dispararse, la alarma emite una **notificación local** (con
sonido/vibración) que llega aunque la app esté en segundo plano.

Para que funcione con la pantalla apagada, Android pedirá **"Permitir siempre"**
la ubicación; conviene además **desactivar la optimización de batería** para
INFOVIP (Ajustes de Android → Batería).

## 🔐 Permisos Android

Capacitor añade los permisos de **ubicación** (GPS en primer plano/segundo
plano) según los plugins declarados. Para lectura de GPS con pantalla apagada
durante largos periodos, Android puede requerir excluir la app de la
optimización de batería (ajuste que solicita el propio sistema).
