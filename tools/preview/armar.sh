#!/usr/bin/env bash
# Arma .preview/ : una copia de node/public con datos falsos enchufados.
#
# Todo lo que sale del repo se pisa en cada corrida, asi que la copia nunca
# queda vieja. Correr esto despues de cada cambio en el front.
#
# Monta las dos pantallas:
#   /            la PWA del inspector   (js/mock.js)
#   /gerencia/   el tablero de gerencia (js/mock-gerencia.js)
#
# Esta misma carpeta es lo que se publica en GitHub Pages, asi que ademas se le
# inyecta el cartelito de "demo con datos inventados". Nada de esto vive en
# node/public/: la app real no lo lleva.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$AQUI/../.." && pwd)"
DST="${1:-$REPO/.preview}"

rm -rf "$DST"
mkdir -p "$DST"
cp -r "$REPO/node/public/." "$DST/"
cp "$AQUI/mock.js"          "$DST/js/mock.js"
cp "$AQUI/demo.js"          "$DST/js/demo.js"
cp "$AQUI/mock-gerencia.js" "$DST/gerencia/js/mock-gerencia.js"

# --- PWA: el mock va DESPUES de las librerias (usa Zonas) y ANTES de app.js,
#     que es quien dispara los fetch.
perl -0pi -e 's{<script src="\./js/app\.js"></script>}{<script src="./js/mock.js"></script>\n<script src="./js/app.js"></script>}' "$DST/index.html"
perl -0pi -e 's{</body>}{<script src="./js/demo.js"></script>\n</body>}' "$DST/index.html"

# --- Tablero: mira window.TABLERO antes de pedir nada, asi que alcanza con
#     definirlo antes de su app.js.
perl -0pi -e 's{<script src="\./js/datos\.js"></script>}{<script src="./js/mock-gerencia.js"></script>\n<script src="./js/datos.js"></script>}' "$DST/gerencia/index.html"
perl -0pi -e 's{</body>}{<script src="../js/demo.js"></script>\n</body>}' "$DST/gerencia/index.html"

# El service worker cachea el app shell por nombre. En la copia publicada hay
# dos archivos mas, y si no entran al SHELL la demo abre rota sin conexion.
perl -0pi -e "s{  './js/app\.js'}{  './js/app.js',\n  './js/mock.js',\n  './js/demo.js'}" "$DST/sw.js"

faltante=0
for marca in \
  "$DST/index.html:js/mock.js" \
  "$DST/index.html:js/demo.js" \
  "$DST/gerencia/index.html:js/mock-gerencia.js" \
  "$DST/gerencia/index.html:js/demo.js" \
  "$DST/sw.js:js/mock.js"
do
  archivo="${marca%%:*}"; texto="${marca##*:}"
  grep -q "$texto" "$archivo" || { echo "ERROR: no se enchufo $texto en $archivo"; faltante=1; }
done
[ "$faltante" = 0 ] || exit 1

echo "listo: $DST"
echo "  PWA       /"
echo "  gerencia  /gerencia/"
echo "para verlo:  perl \"$AQUI/serve.pl\" \"$DST\" 4173"
