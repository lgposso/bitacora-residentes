#!/bin/bash
# Conecta el botón "Sincronizar ahora" del panel con GitHub y publica la versión nueva de la app.
# Uso: ./boton-sincronizar.sh   → pide el token de GitHub (permiso Actions: lectura y escritura).

set -euo pipefail
cd "$(dirname "$0")"
VERCEL=(npx --yes vercel@latest)

ok()    { printf '   \033[32m✓ %s\033[0m\n' "$*"; }
falla() { printf '\n   \033[31m✗ %s\033[0m\n\n' "$*"; exit 1; }

REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

printf '\n\033[1mBotón "Sincronizar ahora"\033[0m\n'
read -r -s -p "   Pegue el token de GitHub (no se verá al pegarlo): " TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ ${#TOKEN} -ge 20 ] || falla "El token parece incompleto."

CODIGO="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/actions/workflows/sincronizar.yml/runs?per_page=1")"
[ "$CODIGO" = 200 ] || falla "GitHub no aceptó el token ($CODIGO). Revise que tenga acceso al repositorio $REPO con permiso Actions: Read and write."
ok "Token válido para $REPO"

printf '%s' "$TOKEN" | "${VERCEL[@]}" env add GITHUB_TOKEN production --force --sensitive >/dev/null
unset TOKEN
ok "Token guardado en Vercel"

git add -A
git diff --cached --quiet || git commit -q -m "Botón Sincronizar ahora y sincronización al cerrar cada sesión"
git push -q origin HEAD
ok "Código actualizado en GitHub"

printf '   Publicando la app (1–2 minutos)…\n'
"${VERCEL[@]}" deploy --prod --yes >/dev/null
ok "App publicada"
printf '\n   Listo. En /admin ya puede usar "Sincronizar ahora".\n\n'
