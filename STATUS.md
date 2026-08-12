# WebReview — Estado y plan para retomar

_Última actualización: 2026-07-31 (sesión 2, antes de reinicio por disco lleno)_

## TL;DR
El **motor funciona y está dockerizado y verificado**. El **plugin de WordPress está
escrito y completo** pero **sin probar**, porque el disco del equipo estaba al 100%
(no cabía WordPress) y Docker Desktop se colgó por la presión de disco.
Tras reiniciar: liberar disco → arrancar motor → instalar WP → probar plugin.

---

## ✅ Hecho y verificado
- **Motor** (`src/`): crawl + captura multi-breakpoint + diff con pixelmatch. CLI (`src/index.js`) y API HTTP (`src/server.js`) con jobs asíncronos + polling + servido estático de `/data`. Probado end-to-end (local y dentro de Docker).
- **Docker**: `Dockerfile` (base `mcr.microsoft.com/playwright:v1.48.0-noble`) + `docker-compose.yml` (servicios: `engine`, `wordpress`, `db`). El contenedor `engine` se construyó y **se verificó capturando dentro de Docker** y sirviendo PNG por HTTP.
  - ⚠️ **Playwright está FIJADO a 1.48.0** en `package.json` para que coincida con la imagen base. No cambiar a `^` sin actualizar también el tag de la imagen (si no, error "Executable doesn't exist").
- **Plugin WordPress** (`wp-plugin/webreview/`): completo. Menú admin, ajustes (api_base / public_base / token), gestión de webs (option `webreview_sites`), AJAX `start`/`status` hacia el motor, vista con **tríptico baseline / actual / diff**.

## ⛔ Bloqueo (causa del reinicio)
- Disco del equipo al 100%: `/System/Volumes/Data` = 201/228 GB, quedaban ~1,7 GB.
- No cupo WordPress (ni Docker `wordpress`+`mariadb`, ni `wp core download` en XAMPP: falló con `No space left on device`).
- Docker Desktop se cayó (socket `~/.docker/run/docker.sock` desaparecido). Se relanzó con `open -a Docker` pero no llegó a levantar antes del reinicio.

---

## 🔧 Plan para retomar (en orden)

### 1. Liberar disco (objetivo: varios GB libres)
La opción elegida por el usuario fue **purgar imágenes Docker sin uso** (~3,8 GB reclamables):
```bash
open -a Docker            # esperar a que el daemon levante (docker version responde)
docker image prune -a -f  # conserva solo imágenes en uso; libera ~3.8GB
docker system df          # comprobar espacio recuperado
df -h /System/Volumes/Data
```
Si sigue justo: revisar Papelera, ~/Downloads y proyectos viejos en htdocs.

### 2. Arrancar el motor
Opción A (Docker, preferida — la imagen `webreview-engine` sigue cacheada):
```bash
cd /Applications/XAMPP/xamppfiles/htdocs/webreview
docker compose up -d engine
curl -s http://localhost:3000/health   # {"ok":true,...}
```
Opción B (sin Docker, si el daemon sigue inestable):
```bash
cd /Applications/XAMPP/xamppfiles/htdocs/webreview
npx playwright install chromium   # instala el browser para la 1.48 (ojo versión)
WEBREVIEW_DATA=./data npm start   # API en :3000
```

### 3. Instalar WordPress en XAMPP (elegido: usar XAMPP, no el WP dockerizado)
Requisitos ya confirmados: `wp-cli` en `/usr/local/bin/wp`, PHP 8.2.4, MySQL de XAMPP por socket, root sin contraseña (`DB_USER=root`, `DB_PASSWORD=''`, `DB_HOST=localhost`).
```bash
WP=/Applications/XAMPP/xamppfiles/htdocs/webreview-wp
mkdir -p "$WP"
wp core download --path="$WP" --locale=es_ES
wp config create --path="$WP" --dbname=webreview_wp --dbuser=root --dbpass='' --dbhost=localhost
wp db create --path="$WP"
wp core install --path="$WP" --url=http://localhost:8899 --title="WebReview" \
  --admin_user=admin --admin_password=admin --admin_email=antonio@blancoleon.com
```
(MySQL de XAMPP debe estar arrancado: `/Applications/XAMPP/xamppfiles/bin/mysql.server start` o desde el panel de XAMPP.)

### 4. Enlazar y activar el plugin
```bash
ln -s /Applications/XAMPP/xamppfiles/htdocs/webreview/wp-plugin/webreview \
      "$WP/wp-content/plugins/webreview"
wp plugin activate webreview --path="$WP"
# Apuntar el plugin al motor (sin Docker interno, todo por localhost):
wp option patch update webreview_settings api_base    http://localhost:3000 --path="$WP"
wp option patch update webreview_settings public_base http://localhost:3000 --path="$WP"
```
> Nota: por defecto el plugin trae `api_base=http://engine:3000` (red Docker). En XAMPP
> hay que ponerlo a `http://localhost:3000`, que es donde escucha el motor.

### 5. Servir WordPress y probar
```bash
wp server --path="$WP" --host=localhost --port=8899   # servidor PHP embebido
```
Abrir http://localhost:8899/wp-admin (admin/admin) → menú **WebReview**:
1. Comprobar banner "Motor conectado ✅".
2. Añadir una web (ej. https://example.com).
3. Pulsar **📸 Baseline** → esperar "done".
4. Pulsar **🔍 Comprobar** → ver el tríptico baseline/actual/diff.

---

## 🐞 Pendientes / cosas a vigilar tras probar
- Verificar que las imágenes cargan desde `http://localhost:3000/data/...` (CORS ya permitido en el server).
- El `head` del shell del usuario está pisado por otra herramienta (no usar `head` en scripts).
- Roadmap siguiente: máscaras de zonas dinámicas, cola persistente (Redis/BullMQ), storage S3/R2, scheduling, informe HTML, y el plugin real multi-tenant (tabla propia en vez de option).
