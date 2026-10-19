# Bitácora de residentes · MGB / Proyecto1

App web para registrar las sesiones académicas de los residentes y guardar las evidencias en Google Drive:

```
MGB/Proyecto1/<Programa>/<Residente>/
  Plan de clase.pdf
  Bitácora.xlsx                  (una fila por sesión)
  Evidencia Sesión N/
    Asistencia Sesión N.xlsx     (estudiantes que escanearon el QR)
    Registro Fotográfico/
    Material Utilizado/
```

## Puesta en marcha (una sola vez)

En la Terminal, dentro de esta carpeta:

```bash
./configurar.sh
```

El asistente hace todo y le va diciendo qué hacer. Solo tendrá que:
1. **Iniciar sesión en Google** con la cuenta donde deben quedar las evidencias (lgposso23@gmail.com) y pulsar **Permitir**.
2. **Iniciar sesión en Vercel** (donde vive la app) y aceptar la base de datos gratuita.
3. **Iniciar sesión en GitHub** (donde corre la sincronización automática).
4. **Escribir la contraseña** que usará para entrar al panel de administración.

Al final le muestra la dirección de la app. Si algo falla, puede volver a ejecutar `./configurar.sh`: continúa donde quedó sin repetir lo que ya estaba hecho.

## Uso diario

| Quién | Dónde | Qué hace |
|---|---|---|
| Administradora | `<app>/admin` | Crea residentes (nombre, programa, correo electrónico y número de documento, que es su contraseña), ve el avance, cambia el documento o elimina residentes. |
| Residente | `<app>` (entra con su correo y su número de documento) | Sube su plan de clase (la primera vez) y en cada sesión: QR → bitácora → fotos → material → finalizar. |
| Estudiantes | Escanean el QR | Registran nombre, correo, universidad y semestre. |

Las evidencias llegan a Drive **automáticamente cuando el residente finaliza la sesión** (en cerca de un minuto), y además cada hora. Para llevar todo lo pendiente en el momento: en `/admin`, botón **Sincronizar ahora**.

## Cómo funciona

- La app (Next.js en Vercel) guarda los datos en Neon (Postgres) y los archivos de forma temporal en Vercel Blob (privado).
- Al cerrar cada sesión, con **Sincronizar ahora** y cada hora, GitHub Actions ejecuta `sync/sincronizar.py`, que pide a la app lo pendiente, arma las carpetas y los Excel, y los copia a Drive con **rclone**. Luego la app borra las copias temporales.
- rclone usa una llave propia de Google (proyecto "Bitacora MGB", cliente "rclone bitacora"; se cambia con `./llave-propia.sh`). Solo puede ver en Drive lo que él mismo creó.
- El botón **Sincronizar ahora** usa un token de GitHub (`GITHUB_TOKEN` en Vercel) limitado a este repositorio; se configura con `./boton-sincronizar.sh`.

## Desarrollo

```bash
npm install
```
```bash
npm run local
```
La app corre en http://localhost:3000 sin ninguna cuenta (base de datos y archivos en memoria). Admin: `admin123`.

- `npm test`: pruebas de la app (flujo completo y sincronización).
- `.venv/bin/pytest sync`: pruebas del sincronizador (crear el entorno con `python3 -m venv .venv && .venv/bin/pip install -r sync/requirements.txt pytest`).
- Probar la sincronización contra la app local, hacia una carpeta en vez de Drive:
  ```bash
  APP_URL=http://localhost:3000 SYNC_TOKEN=token-local-de-pruebas-123456 RCLONE_CONFIG_PRUEBA_TYPE=local RCLONE_REMOTO=prueba:/tmp/drive-prueba .venv/bin/python sync/sincronizar.py
  ```
