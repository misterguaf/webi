#!/bin/bash

# Launcher mestre macOS. La raíz és relativa a este fitxer, així el projecte
# pot moure's sencer sense actualitzar cap ruta.
set -e
LAUNCHER_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$LAUNCHER_DIR/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "No trobe npm. Instal·la Node.js i torna a obrir este launcher."
  if [ -t 0 ]; then read -r -p "Prem Intro per a tancar... "; fi
  exit 1
fi

if [ ! -f "$PROJECT_ROOT/package.json" ] || [ ! -f "$PROJECT_ROOT/scripts/dev-master.js" ] ||
   ! node -e 'const p=require(process.argv[1]); process.exit(p.name === "web-parpallo" ? 0 : 1)' "$PROJECT_ROOT/package.json"; then
  echo "Esta carpeta no sembla l'arrel del projecte Parpalló."
  if [ -t 0 ]; then read -r -p "Prem Intro per a tancar... "; fi
  exit 1
fi

cd "$PROJECT_ROOT"
exec node "$PROJECT_ROOT/scripts/dev-master.js"
