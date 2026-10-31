#!/usr/bin/env bash
# Ignored Build Step de Vercel (se engancha desde apps/web/vercel.json → "ignoreCommand").
# Contrato de Vercel: exit 0 = NO construir, exit 1 = construir.
#
# Reglas (ahorro de Build CPU Minutes; la verificación la hace GitHub Actions, ver .github/workflows/ci.yml):
#   - Rama distinta de main: solo se construye el preview si el mensaje del último commit contiene "[preview]".
#   - main: se construye solo si cambió algo que afecta a la web entre VERCEL_GIT_PREVIOUS_SHA y VERCEL_GIT_COMMIT_SHA.
#   - Ante la duda (sin SHA previo, clone superficial, git roto, rama desconocida): se construye.
#     Saltear un deploy real por error es peor que gastar unos minutos de build.
#
# Se puede probar a mano:
#   VERCEL_GIT_COMMIT_REF=main VERCEL_GIT_PREVIOUS_SHA=<sha> VERCEL_GIT_COMMIT_SHA=<sha> bash scripts/vercel-ignore.sh; echo $?

set -u

# Rutas que, si cambian, cambian lo que Vercel construye. Relativas a la raíz del repo.
# Además de lo básico (apps/web, packages, package.json, lockfile, vercel.json, next.config.*):
# turbo.json define qué variables llegan a `next build` (passThroughEnv), pnpm-workspace.yaml y
# tsconfig.base.json cambian la instalación y la compilación, y .nvmrc el Node.
# `apps/web` ya incluye vercel.json y next.config.*; se listan igual para que el contrato sea explícito.
WEB_PATHS=(
  apps/web
  packages
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  .nvmrc
  vercel.json
  'next.config.*'
)

log() { echo "[vercel-ignore] $*"; }
build() { log "CONSTRUIR: $*"; exit 1; }
skip() { log "OMITIR build: $*"; exit 0; }

ref="${VERCEL_GIT_COMMIT_REF:-}"
msg="${VERCEL_GIT_COMMIT_MESSAGE:-}"
sha="${VERCEL_GIT_COMMIT_SHA:-}"
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"

if [ -z "$ref" ]; then
  build "VERCEL_GIT_COMMIT_REF vacío, no se puede saber la rama"
fi

# --- Ramas que no son main: preview solo a pedido -----------------------------------------------
if [ "$ref" != "main" ]; then
  case "$msg" in
    *"[preview]"*) build "rama '$ref' con [preview] en el mensaje del último commit" ;;
    *) skip "rama '$ref' sin [preview] en el mensaje del último commit (la verificación corre en GitHub Actions)" ;;
  esac
fi

# --- main: solo si cambió algo que afecta a la web ----------------------------------------------
if [ -z "$prev" ]; then
  build "main sin VERCEL_GIT_PREVIOUS_SHA (primer deploy o dato no disponible)"
fi
if [ -z "$sha" ]; then
  build "main sin VERCEL_GIT_COMMIT_SHA"
fi

# Vercel puede ejecutar el comando desde apps/web (Root Directory); los pathspecs son de la raíz.
root="$(git rev-parse --show-toplevel 2>/dev/null)" || build "no se pudo ubicar la raíz del repo"
cd "$root" || build "no se pudo entrar a la raíz del repo ($root)"

git diff --quiet "$prev" "$sha" -- "${WEB_PATHS[@]}" 2>/dev/null
rc=$?
case "$rc" in
  0) skip "main sin cambios en rutas de la web entre ${prev:0:7} y ${sha:0:7}" ;;
  1) build "main con cambios en rutas de la web entre ${prev:0:7} y ${sha:0:7}" ;;
  *) build "git diff ${prev:0:7}..${sha:0:7} falló (rc=$rc; probable clone superficial sin ese commit)" ;;
esac
