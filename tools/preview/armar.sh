#!/usr/bin/env bash
# Arma .preview/ : una copia de node/public con datos falsos enchufados.
#
# Todo lo que sale del repo se pisa en cada corrida, asi que la copia nunca
# queda vieja. Correr esto despues de cada cambio en el front.
#
# Monta las dos pantallas:
#   /            la PWA del inspector   (js/mock.js)
#   /gerencia/   el tablero de gerencia (js/mock-gerencia.js)
set -e
AQUI="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$AQUI/../.." && pwd)"
DST="$REPO/.preview"

rm -rf "$DST"
mkdir -p "$DST"
cp -r "$REPO/node/public/." "$DST/"
cp "$AQUI/mock.js" "$DST/js/mock.js"
cp "$AQUI/mock-gerencia.js" "$DST/gerencia/js/mock-gerencia.js"

# mock.js va DESPUES de las librerias (usa Zonas) y ANTES de app.js, que es
# quien dispara los fetch.
perl -0pi -e 's{<script src="\./js/app\.js"></script>}{<script src="./js/mock.js"></script>\n<script src="./js/app.js"></script>}' "$DST/index.html"

# El tablero mira window.TABLERO antes de pedir nada, asi que alcanza con
# definirlo antes de su app.js.
perl -0pi -e 's{<script src="\./js/datos\.js"></script>}{<script src="./js/mock-gerencia.js"></script>\n<script src="./js/datos.js"></script>}' "$DST/gerencia/index.html"

grep -q 'js/mock.js' "$DST/index.html" || { echo "ERROR: no se pudo enchufar mock.js"; exit 1; }
grep -q 'js/mock-gerencia.js' "$DST/gerencia/index.html" || { echo "ERROR: no se pudo enchufar mock-gerencia.js"; exit 1; }

echo "listo: $DST"
echo "  PWA       http://127.0.0.1:4173/"
echo "  gerencia  http://127.0.0.1:4173/gerencia/"
echo "ahora:  perl \"$AQUI/serve.pl\" \"$DST\" 4173"
