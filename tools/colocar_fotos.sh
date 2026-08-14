#!/usr/bin/env bash
# ============================================================================
# Acomoda las fotos historicas bajadas de Drive y completa sus rutas en la DB.
#
# Corre en el VPS, DESPUES de haber traido las fotos con rclone.
#
#   bash tools/colocar_fotos.sh /ruta/donde/bajo/rclone
#
# El SQL se genera SOLO para los archivos que realmente se copiaron. Si una
# foto no aparece, su registro queda con ruta NULL y sigue contando en
# v_fotos_pendientes: preferimos "no la tenemos" antes que una imagen rota.
# ============================================================================
set -uo pipefail

ORIGEN="${1:-}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(dirname "$AQUI")"
MANIFIESTO="$AQUI/fotos_manifiesto.tsv"
STAGING="${STAGING:-/tmp/yard_fotos}"
SQL="/tmp/004_rutas_fotos.sql"
FALTANTES="/tmp/fotos_faltantes.txt"
COMPOSE="docker compose -f $RAIZ/docker-compose.yml"

if [ -z "$ORIGEN" ] || [ ! -d "$ORIGEN" ]; then
  echo "Uso: bash tools/colocar_fotos.sh <carpeta con las fotos bajadas de Drive>"
  echo
  echo "Antes de esto, traelas con rclone. Acordate de incluir LAS DOS carpetas:"
  echo "  rclone copy 'gdrive:Form Responses 1_Images' /srv/fotos_appsheet -P"
  echo "  rclone copy 'gdrive:Patrullas Seguridad, Calidad, 5S_Images' /srv/fotos_appsheet -P"
  exit 1
fi
[ -f "$MANIFIESTO" ] || { echo "Falta $MANIFIESTO (generalo con generar_manifiesto_fotos.ps1)"; exit 1; }
[ -f "$RAIZ/.env" ] || { echo "Falta .env"; exit 1; }
set -a; . "$RAIZ/.env"; set +a

echo "==> Indexando archivos en $ORIGEN"
declare -A INDICE
total_arch=0
while IFS= read -r -d '' f; do
  b="$(basename "$f")"
  # minusculas: Drive a veces cambia el casing al descargar
  k="${b,,}"
  if [ -z "${INDICE[$k]:-}" ]; then INDICE["$k"]="$f"; fi
  total_arch=$((total_arch+1))
done < <(find "$ORIGEN" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0)
echo "    $total_arch archivos indexados (${#INDICE[@]} nombres unicos)"

echo "==> Copiando segun el manifiesto"
rm -rf "$STAGING"; mkdir -p "$STAGING"
: > "$SQL"; : > "$FALTANTES"

{
  echo "-- Rutas de las fotos historicas efectivamente copiadas."
  echo "-- Generado por tools/colocar_fotos.sh. No editar a mano."
  echo "SET NAMES utf8mb4;"
  echo "START TRANSACTION;"
} >> "$SQL"

esc() { printf '%s' "$1" | sed "s/'/''/g"; }

copiadas=0; faltan=0; linea=0
while IFS=$'\t' read -r uuid tipo base origen destino; do
  linea=$((linea+1))
  [ "$linea" -eq 1 ] && continue     # cabecera

  # Blindaje: si el manifiesto llegara con CRLF, el \r se pegaria al final de
  # destino y los archivos terminarian con retorno de carro en el nombre.
  destino="${destino%$'\r'}"
  origen="${origen%$'\r'}"

  k="${base,,}"
  ruta_src="${INDICE[$k]:-}"
  if [ -z "$ruta_src" ]; then
    faltan=$((faltan+1))
    printf '%s\t%s\n' "$tipo" "$origen" >> "$FALTANTES"
    continue
  fi

  mkdir -p "$STAGING/$(dirname "$destino")"
  if cp -n "$ruta_src" "$STAGING/$destino" 2>/dev/null || [ -f "$STAGING/$destino" ]; then
    copiadas=$((copiadas+1))
    if [ "$tipo" = "checklist" ]; then
      echo "UPDATE inspeccion SET foto_checklist='$(esc "$destino")' WHERE uuid='$(esc "$uuid")';" >> "$SQL"
    else
      echo "UPDATE inspeccion_foto f JOIN inspeccion i ON i.id=f.inspeccion_id SET f.ruta='$(esc "$destino")' WHERE i.uuid='$(esc "$uuid")' AND f.ruta_origen='$(esc "$origen")';" >> "$SQL"
    fi
  else
    faltan=$((faltan+1))
    printf '%s\t%s\n' "$tipo" "$origen" >> "$FALTANTES"
  fi
done < "$MANIFIESTO"

echo "COMMIT;" >> "$SQL"

echo "    copiadas: $copiadas | faltantes: $faltan"
[ "$faltan" -gt 0 ] && echo "    lista de faltantes en $FALTANTES"

if [ "$copiadas" -eq 0 ]; then
  echo "No se copio ninguna foto. Revisa que $ORIGEN sea la carpeta correcta."
  exit 1
fi

echo "==> Pasando los archivos al volumen del contenedor"
$COMPOSE cp "$STAGING/historico" yard-backend:/app/uploads/ || {
  echo "Fallo el copy al contenedor. Esta levantado yard-backend?"; exit 1; }

echo "==> Aplicando las rutas en la base"
$COMPOSE exec -T db_yard mysql -uroot -p"${DB_ROOT_PASSWORD}" "${DB_NAME:-yard}" < "$SQL" || {
  echo "Fallo el UPDATE. El SQL quedo en $SQL"; exit 1; }

echo
echo "==> Resultado"
pend=$($COMPOSE exec -T db_yard mysql -uroot -p"${DB_ROOT_PASSWORD}" -N -B "${DB_NAME:-yard}" \
  -e 'SELECT COUNT(*) FROM v_fotos_pendientes' 2>/dev/null)
chk=$($COMPOSE exec -T db_yard mysql -uroot -p"${DB_ROOT_PASSWORD}" -N -B "${DB_NAME:-yard}" \
  -e 'SELECT COUNT(*) FROM inspeccion WHERE foto_checklist_origen IS NOT NULL AND foto_checklist IS NULL' 2>/dev/null)
echo "    fotos de desvio pendientes : $pend"
echo "    checklists pendientes      : $chk"
[ "${pend:-1}" = "0" ] && [ "${chk:-1}" = "0" ] && echo "    Todas las fotos quedaron enlazadas."
rm -rf "$STAGING"
