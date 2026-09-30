#!/bin/bash
# Asistente de configuración de la Bitácora de residentes.
# Se ejecuta una vez (y se puede repetir sin dañar nada):   ./configurar.sh
#
# Deja funcionando:
#   · la app en Vercel (con base de datos Neon y almacenamiento Blob),
#   · la conexión con Google Drive mediante rclone (sin consola de Google Cloud),
#   · la sincronización automática cada 30 minutos en GitHub Actions.
# Las contraseñas y claves se escriben o generan aquí mismo; nunca se muestran en pantalla.

set -euo pipefail
cd "$(dirname "$0")"

PROYECTO="bitacora-residentes"
REMOTO="gdrive"
CONF=".configuracion.local"   # guarda las claves generadas para poder repetir el asistente
VERCEL=(npx --yes vercel@latest)

paso()  { printf '\n\033[1;36m━━ Paso %s de 8 · %s\033[0m\n' "$1" "$2"; }
info()  { printf '   %s\n' "$*"; }
ok()    { printf '   \033[32m✓ %s\033[0m\n' "$*"; }
aviso() { printf '   \033[33m! %s\033[0m\n' "$*"; }
falla() { printf '\n   \033[31m✗ %s\033[0m\n\n' "$*"; exit 1; }
pausa() { read -r -p "   Pulse Enter para continuar… " _; }
clave() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }

# Variables ya configuradas en Vercel (solo los nombres).
vars_vercel() { "${VERCEL[@]}" env ls production 2>/dev/null || true; }
tiene_var() { grep -qw "$1" <<<"$VARS"; }
poner_var() { # nombre valor [--no-sensitive]
  printf '%s' "$2" | "${VERCEL[@]}" env add "$1" production --force "${3:---sensitive}" >/dev/null
}

touch "$CONF" && chmod 600 "$CONF"
# shellcheck disable=SC1090
source "$CONF"
guardar_conf() { printf 'SESSION_SECRET=%q\nSYNC_TOKEN=%q\n' "$SESSION_SECRET" "$SYNC_TOKEN" > "$CONF"; }
SESSION_SECRET="${SESSION_SECRET:-$(clave)}"
SYNC_TOKEN="${SYNC_TOKEN:-$(clave)}"
guardar_conf

printf '\n\033[1mBitácora de residentes · Asistente de configuración\033[0m\n'
info "Tardará unos 10 minutos. Se abrirá el navegador 3 veces para iniciar sesión (Google, Vercel y GitHub)."

# ─────────────────────────────────────────────────────────────
paso 1 "Instalar herramientas"
command -v brew >/dev/null || falla "Falta Homebrew. Instálelo desde https://brew.sh y vuelva a ejecutar ./configurar.sh"
for h in rclone gh node git; do
  command -v "$h" >/dev/null || { info "Instalando ${h}…"; brew install "$h" >/dev/null; }
done
ok "rclone, gh, node y git listos"

# ─────────────────────────────────────────────────────────────
paso 2 "Conectar Google Drive"
if rclone listremotes 2>/dev/null | grep -qx "$REMOTO:"; then
  ok "Google Drive ya estaba conectado"
else
  info "Se abrirá el navegador. Inicie sesión con la cuenta donde deben quedar las evidencias"
  info "(lgposso23@gmail.com) y pulse \"Permitir\"."
  pausa
  rclone config create "$REMOTO" drive scope=drive.file >/dev/null
fi
rclone lsd "$REMOTO:" >/dev/null 2>&1 || falla "rclone no pudo entrar a Google Drive. Ejecute: rclone config reconnect $REMOTO:"
ok "Google Drive responde"

# ─────────────────────────────────────────────────────────────
paso 3 "Cuenta de Vercel"
if ! "${VERCEL[@]}" whoami >/dev/null 2>&1; then
  info "Se abrirá el navegador para iniciar sesión en Vercel (puede crear la cuenta gratis con su correo o con GitHub)."
  "${VERCEL[@]}" login
fi
if [ ! -f .vercel/project.json ]; then
  "${VERCEL[@]}" link --yes --project "$PROYECTO" >/dev/null 2>&1 || {
    "${VERCEL[@]}" project add "$PROYECTO" >/dev/null
    "${VERCEL[@]}" link --yes --project "$PROYECTO" >/dev/null
  }
fi
ok "Proyecto \"$PROYECTO\" vinculado"

# ─────────────────────────────────────────────────────────────
paso 4 "Base de datos y almacenamiento (Vercel)"
VARS="$(vars_vercel)"
if ! tiene_var DATABASE_URL; then
  info "Instalando Neon (base de datos). Si pregunta, acepte los términos y elija el plan gratuito (Free)."
  "${VERCEL[@]}" integration add neon
fi
if ! tiene_var BLOB_READ_WRITE_TOKEN; then
  info "Creando el almacenamiento privado de archivos…"
  "${VERCEL[@]}" blob create-store bitacora-evidencias --access private --yes >/dev/null
fi
VARS="$(vars_vercel)"
tiene_var DATABASE_URL || falla "No quedó DATABASE_URL en Vercel. Revise la integración de Neon y ejecute de nuevo el asistente."
tiene_var BLOB_READ_WRITE_TOKEN || falla "No quedó BLOB_READ_WRITE_TOKEN en Vercel. Ejecute de nuevo el asistente."
ok "Neon y Blob conectados"

# ─────────────────────────────────────────────────────────────
paso 5 "Contraseña de administradora"
if tiene_var ADMIN_PASSWORD; then
  ok "Ya estaba configurada (para cambiarla: npx vercel env rm ADMIN_PASSWORD production y repita el asistente)"
else
  while true; do
    read -r -s -p "   Escriba la contraseña para entrar a /admin (mínimo 8 caracteres): " P1; echo
    read -r -s -p "   Repítala: " P2; echo
    [ "$P1" = "$P2" ] && [ ${#P1} -ge 8 ] && break
    aviso "No coinciden o es muy corta. Intente de nuevo."
  done
  poner_var ADMIN_PASSWORD "$P1"
  unset P1 P2
  ok "Contraseña guardada en Vercel"
fi
tiene_var SESSION_SECRET || poner_var SESSION_SECRET "$SESSION_SECRET"
poner_var SYNC_TOKEN "$SYNC_TOKEN"
ok "Claves internas generadas"

# ─────────────────────────────────────────────────────────────
paso 6 "Repositorio privado en GitHub (para la sincronización automática)"
if ! gh auth status >/dev/null 2>&1; then
  info "Se abrirá el navegador para iniciar sesión en GitHub (puede crear la cuenta gratis)."
  gh auth login --web --hostname github.com --git-protocol https
fi
[ -d .git ] || git init -q -b main
if [ -z "$(git config user.email || true)" ]; then
  USUARIO_GH="$(gh api user -q .login)"
  git config user.name "$USUARIO_GH"
  git config user.email "$(gh api user -q .id)+$USUARIO_GH@users.noreply.github.com"
fi
git add -A
git diff --cached --quiet || git commit -q -m "Bitácora de residentes"
if git remote get-url origin >/dev/null 2>&1; then
  git push -q origin HEAD
else
  gh repo create "$PROYECTO" --private --source . --remote origin --push >/dev/null
fi
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
poner_var GITHUB_REPO "$REPO" --no-sensitive
ok "Repositorio privado: https://github.com/$REPO"

# ─────────────────────────────────────────────────────────────
paso 7 "Publicar la app"
info "Publicando (tarda 1–2 minutos)…"
URL_DESPLIEGUE="$("${VERCEL[@]}" deploy --prod --yes | tail -1)"
[[ "$URL_DESPLIEGUE" == https://* ]] || falla "La publicación falló (ver mensajes arriba). Ejecute de nuevo ./configurar.sh"
APP_URL="$("${VERCEL[@]}" inspect "$URL_DESPLIEGUE" --json 2>/dev/null | node -e '
  let t = ""; process.stdin.on("data", d => t += d).on("end", () => {
    try {
      const a = (JSON.parse(t).aliases || []).filter(x => /\.vercel\.app$/.test(x)).sort((x, y) => x.length - y.length);
      process.stdout.write(a.length ? "https://" + a[0].replace(/^https?:\/\//, "") : "");
    } catch { }
  });')" || true
APP_URL="${APP_URL:-$URL_DESPLIEGUE}"
read -r -p "   Dirección de la app [$APP_URL]: " OTRA
APP_URL="${OTRA:-$APP_URL}"
APP_URL="${APP_URL%/}"
ok "App publicada en $APP_URL"

# ─────────────────────────────────────────────────────────────
paso 8 "Sincronización automática con Google Drive"
rclone config show "$REMOTO" | gh secret set RCLONE_CONF --repo "$REPO" >/dev/null
printf '%s' "$SYNC_TOKEN" | gh secret set SYNC_TOKEN --repo "$REPO" >/dev/null
gh variable set APP_URL --repo "$REPO" --body "$APP_URL" >/dev/null
gh workflow run sincronizar.yml --repo "$REPO" >/dev/null 2>&1 || aviso "La primera sincronización arrancará sola en los próximos 30 minutos."
ok "Se sincroniza cada 30 minutos (primera corrida lanzada ahora)"

printf '\n\033[1;32m¡Listo!\033[0m\n'
info "App de residentes:   $APP_URL"
info "Administración:      $APP_URL/admin   (con la contraseña que escribió en el paso 5)"
info "Evidencias en Drive: carpeta MGB/Proyecto1 (aparece con la primera sincronización)"
info "Sincronizar ya:      https://github.com/$REPO/actions/workflows/sincronizar.yml → Run workflow"
echo
