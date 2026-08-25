#!/usr/bin/env bash
# Arma .preview/ : una copia de node/public con datos falsos enchufados.
#
# Todo lo que sale del repo se pisa en cada corrida, asi que la copia nunca
# queda vieja. Correr esto despues de cada cambio en el front.
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$AQUI/../.." && pwd)"
DST="$REPO/.preview"

rm -rf "$DST"
mkdir -p "$DST"
cp -r "$REPO/node/public/." "$DST/"
cp "$AQUI/mock.js" "$DST/js/mock.js"

# mock.js va DESPUES de las librerias (usa Zonas) y ANTES de app.js, que es
# quien dispara los fetch.
perl -0pi -e 's{<script src="\./js/app\.js"></script>}{<script src="./js/mock.js"></script>\n<script src="./js/app.js"></script>}' "$DST/index.html"

grep -q 'js/mock.js' "$DST/index.html" || { echo "ERROR: no se pudo enchufar mock.js"; exit 1; }
echo "listo: $DST"
echo "ahora:  perl \"$AQUI/serve.pl\" \"$DST\" 4173   ->  http://127.0.0.1:4173/"
