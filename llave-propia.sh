#!/bin/bash
# Cambia rclone a una llave de Google propia (la llave compartida de rclone se retira en 2026).
# Uso: ./llave-propia.sh   → pide el ID y el secreto del cliente OAuth "App de escritorio".

set -euo pipefail
cd "$(dirname "$0")"
REMOTO="gdrive"

ok()    { printf '   \033[32m✓ %s\033[0m\n' "$*"; }
falla() { printf '\n   \033[31m✗ %s\033[0m\n\n' "$*"; exit 1; }

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

printf '\n\033[1mLlave propia de Google para la sincronización\033[0m\n'
read -r -p "   Pegue el ID de cliente: " ID
ID="$(printf '%s' "$ID" | tr -d '[:space:]')"
[[ "$ID" == *.apps.googleusercontent.com ]] || falla "Eso no parece un ID de cliente (termina en .apps.googleusercontent.com)."
read -r -s -p "   Pegue el secreto del cliente (no se verá al pegarlo): " SECRETO; echo
SECRETO="$(printf '%s' "$SECRETO" | tr -d '[:space:]')"
[ ${#SECRETO} -ge 20 ] || falla "El secreto parece incompleto."

rclone config update "$REMOTO" client_id "$ID" client_secret "$SECRETO" scope drive.file config_refresh_token false >/dev/null
unset SECRETO
printf '\n   Se abrirá el navegador: elija lgposso23@gmail.com y pulse "Continuar"/"Permitir".\n'
printf '   (Si Google avisa que la app no está verificada: "Configuración avanzada" → "Ir a …").\n\n'
rclone config reconnect "$REMOTO:" --auto-confirm
rclone lsd "$REMOTO:" >/dev/null 2>&1 || falla "rclone no pudo entrar a Google Drive con la llave nueva."
ok "rclone usa ahora su llave propia"

rclone config show "$REMOTO" | gh secret set RCLONE_CONF --repo "$REPO" >/dev/null
ok "GitHub actualizado"
printf '\n   Listo. Ahora, en /admin, pulse "Reenviar carpetas y hojas".\n\n'
