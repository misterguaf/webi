#!/bin/bash

# Launcher de macOS: arranca el portal de prueba, abre el navegador y deja el
# servidor en esta ventana de Terminal. Para cerrarlo, pulsa Ctrl+C.
# El lanzador vive en Web Parpallo/Launchers; trabaja siempre desde la raíz
# de la web aunque la carpeta completa se mueva a otra ubicación.
cd "$(dirname "$0")/.." || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "No encuentro npm. Instala Node.js y vuelve a abrir este archivo."
  read -r -p "Pulsa Intro para cerrar... "
  exit 1
fi

echo "Arrancando el portal local de Parpalló..."
echo "La contraseña ficticia para probar es: families-demo"
echo "Los envíos son simulados; no llegan a Sheets, Drive ni correo."
echo
npm run dev:portal -- --open

status=$?
echo
if [ "$status" -ne 0 ]; then
  echo "El portal se ha cerrado con un error (código $status)."
  read -r -p "Pulsa Intro para cerrar... "
fi
exit "$status"
