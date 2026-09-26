#!/bin/bash

# Launcher de macOS: inicia la web pública en modo local seguro, abre la portada
# y deja el servidor en esta ventana de Terminal. Para cerrarlo, pulsa Ctrl+C.
# El lanzador vive en Web Parpallo/Launchers; trabaja siempre desde la raíz
# de la web aunque la carpeta completa se mueva a otra ubicación.
cd "$(dirname "$0")/.." || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "No encuentro npm. Instala Node.js y vuelve a abrir este archivo."
  read -r -p "Pulsa Intro para cerrar... "
  exit 1
fi

echo "Arrancando la web general de Parpalló..."
echo "Modo seguro: datos sintéticos y Google Sheets simulado."
echo "No se envía ni se guarda nada fuera de este ordenador."
echo
npm run dev:site -- --open

status=$?
echo
if [ "$status" -ne 0 ]; then
  echo "La web se ha cerrado con un error (código $status)."
  read -r -p "Pulsa Intro para cerrar... "
fi
exit "$status"
