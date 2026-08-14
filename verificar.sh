#!/usr/bin/env bash
# ============================================================================
# Verificacion end-to-end. Correr en el VPS (o donde haya Docker).
#
#   bash verificar.sh
#
# Levanta el stack en modo dev, espera la DB, valida que el esquema y los
# catalogos hayan quedado bien, y prueba la API incluyendo el caso critico:
# que reenviar la misma inspeccion NO duplique.
#
# No es un test suite. Es un chequeo de humo para saber si esto arranca.
# ============================================================================
set -uo pipefail

API="${API:-http://localhost:3002}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"
ok=0; fallo=0

verde() { printf '  \033[32mOK\033[0m   %s\n' "$1"; ok=$((ok+1)); }
rojo()  { printf '  \033[31mFALLA\033[0m %s\n' "$1"; fallo=$((fallo+1)); }

chequear() { # descripcion, valor_obtenido, valor_esperado
  if [ "$2" = "$3" ]; then verde "$1 ($2)"; else rojo "$1: esperaba '$3', obtuve '$2'"; fi
}

sql() { $COMPOSE exec -T db_yard mysql -uroot -p"${DB_ROOT_PASSWORD}" -N -B "${DB_NAME:-yard}" -e "$1" 2>/dev/null; }

if [ ! -f .env ]; then
  echo "Falta .env. Copialo de .env.example y completa las passwords."
  exit 1
fi
set -a; . ./.env; set +a

echo "==> Levantando stack"
$COMPOSE up -d --build || { echo "no se pudo levantar"; exit 1; }

echo "==> Esperando a MySQL"
for i in $(seq 1 60); do
  if sql "SELECT 1" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = "60" ] && { echo "MySQL no respondio en 2 min"; $COMPOSE logs db_yard | tail -30; exit 1; }
done

echo
echo "== Esquema =="
chequear "tablas creadas" "$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME:-yard}'")" "11"

echo
echo "== Catalogos =="
chequear "tipos de desvio"   "$(sql 'SELECT COUNT(*) FROM tipo_desvio')"     "4"
chequear "responsables"      "$(sql 'SELECT COUNT(*) FROM responsable')"     "11"
chequear "demoras"           "$(sql 'SELECT COUNT(*) FROM demora')"          "3"
chequear "controladores"     "$(sql 'SELECT COUNT(*) FROM controlador')"     "7"
chequear "estados de control" "$(sql 'SELECT COUNT(*) FROM estado_control')" "3"
chequear "desvios"           "$(sql 'SELECT COUNT(*) FROM desvio_catalogo')" "71"
chequear "desvios sin tipo"  "$(sql 'SELECT COUNT(*) FROM desvio_catalogo WHERE tipo_desvio_id IS NULL')" "0"
chequear "'Otro' exige detalle" "$(sql "SELECT requiere_detalle FROM desvio_catalogo WHERE nombre='Otro'")" "1"

# Si los acentos se rompieron en la carga, esto no encuentra nada.
chequear "acentos intactos" "$(sql "SELECT COUNT(*) FROM desvio_catalogo WHERE nombre LIKE '%xido%' AND nombre NOT LIKE '%Ã%'")" "4"

echo
echo "== CHECK constraint =="
# Se usan IDs reales a proposito: con valores inventados el INSERT fallaria por
# foreign key y el test daria por bueno el CHECK sin haberlo probado.
sql "INSERT IGNORE INTO usuario (email,rol) VALUES ('verificar@ttfasa.com','inspector')" >/dev/null 2>&1
U_ID=$(sql "SELECT id FROM usuario WHERE email='verificar@ttfasa.com'")
R_ID=$(sql "SELECT id FROM responsable ORDER BY orden LIMIT 1")
T_ID=$(sql "SELECT id FROM tipo_desvio WHERE nombre='5s'")

if [ -z "$U_ID" ] || [ -z "$R_ID" ] || [ -z "$T_ID" ]; then
  rojo "no se pudieron obtener IDs reales para probar el CHECK"
else
  # 1) control: los mismos IDs, sin violar el CHECK -> tiene que ENTRAR.
  #    Si esto falla, lo de abajo no prueba nada.
  err_ctl=$(sql "INSERT INTO inspeccion (uuid,registrado_en,auditor_id,responsable_id,resultado)
                 VALUES ('00000000-0000-0000-0000-0000000000fe',NOW(),$U_ID,$R_ID,'OK')" 2>&1)
  entro=$(sql "SELECT COUNT(*) FROM inspeccion WHERE uuid='00000000-0000-0000-0000-0000000000fe'")
  chequear "control: un OK valido entra" "$entro" "1"

  # 2) el mismo OK pero con tipo de desvio -> lo tiene que rechazar el CHECK.
  sql "INSERT INTO inspeccion (uuid,registrado_en,auditor_id,responsable_id,resultado,tipo_desvio_id)
       VALUES ('00000000-0000-0000-0000-0000000000ff',NOW(),$U_ID,$R_ID,'OK',$T_ID)" >/dev/null 2>&1
  metido=$(sql "SELECT COUNT(*) FROM inspeccion WHERE uuid='00000000-0000-0000-0000-0000000000ff'")
  chequear "rechaza un OK con tipo de desvio" "$metido" "0"

  sql "DELETE FROM inspeccion WHERE uuid IN ('00000000-0000-0000-0000-0000000000fe','00000000-0000-0000-0000-0000000000ff')" >/dev/null 2>&1
  sql "DELETE FROM usuario WHERE email='verificar@ttfasa.com'" >/dev/null 2>&1
fi

echo
echo "== API =="
for i in $(seq 1 30); do
  curl -sf "$API/health" >/dev/null 2>&1 && break
  sleep 2
  [ "$i" = "30" ] && { rojo "el backend no responde en $API"; $COMPOSE logs yard-backend | tail -40; }
done

chequear "health" "$(curl -s "$API/health" | grep -c '"ok":true')" "1"

cat_json=$(curl -s "$API/api/catalogos")
chequear "catalogos responde desvios" "$(echo "$cat_json" | grep -c '"desvios"')" "1"

UUID="11111111-2222-3333-4444-555555555555"
sql "DELETE FROM inspeccion WHERE uuid='$UUID'" >/dev/null 2>&1

RESP_ID=$(sql "SELECT id FROM responsable ORDER BY orden LIMIT 1")
TIPO_ID=$(sql "SELECT id FROM tipo_desvio WHERE nombre='5s'")
DESV_ID=$(sql "SELECT id FROM desvio_catalogo ORDER BY usos_historicos DESC LIMIT 1")

payload=$(printf '{"uuid":"%s","registrado_en":"%s","responsable_id":%s,"equipo_codigo":9999,"resultado":"NG","tipo_desvio_id":%s,"desvio_ids":[%s]}' \
  "$UUID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RESP_ID" "$TIPO_ID" "$DESV_ID")

c1=$(curl -s -o /tmp/y1.json -w '%{http_code}' -X POST "$API/api/inspecciones" -H 'Content-Type: application/json' -d "$payload")
chequear "alta de inspeccion" "$c1" "201"

# ESTE es el chequeo que importa para el offline: reenviar la misma inspeccion.
c2=$(curl -s -o /tmp/y2.json -w '%{http_code}' -X POST "$API/api/inspecciones" -H 'Content-Type: application/json' -d "$payload")
chequear "reenvio devuelve 200 (no error)" "$c2" "200"
chequear "reenvio marcado como duplicada" "$(grep -c '"duplicada":true' /tmp/y2.json)" "1"
chequear "no se duplico en la DB" "$(sql "SELECT COUNT(*) FROM inspeccion WHERE uuid='$UUID'")" "1"

chequear "patrulla del dia trae el NG" "$(curl -s "$API/api/inspecciones/hoy" | grep -c "$UUID")" "1"
chequear "historial por camion" "$(curl -s "$API/api/inspecciones?equipo=9999" | grep -c "$UUID")" "1"

# Un OK no debe aparecer en la patrulla del dia
UUID_OK="11111111-2222-3333-4444-5555555555aa"
sql "DELETE FROM inspeccion WHERE uuid='$UUID_OK'" >/dev/null 2>&1
payload_ok=$(printf '{"uuid":"%s","registrado_en":"%s","responsable_id":%s,"equipo_codigo":9999,"resultado":"OK"}' \
  "$UUID_OK" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RESP_ID")
curl -s -o /dev/null -X POST "$API/api/inspecciones" -H 'Content-Type: application/json' -d "$payload_ok"
chequear "el OK NO aparece en la patrulla del dia" "$(curl -s "$API/api/inspecciones/hoy" | grep -c "$UUID_OK")" "0"
chequear "el OK SI aparece en el historial" "$(curl -s "$API/api/inspecciones?equipo=9999" | grep -c "$UUID_OK")" "1"

echo
echo "==> Limpiando datos de prueba"
sql "DELETE FROM inspeccion WHERE uuid IN ('$UUID','$UUID_OK')" >/dev/null 2>&1
sql "DELETE FROM equipo WHERE codigo=9999" >/dev/null 2>&1

echo
echo "======================================"
printf "  OK: %s   FALLAS: %s\n" "$ok" "$fallo"
echo "======================================"
[ "$fallo" -eq 0 ] || { echo; echo "Logs del backend:"; $COMPOSE logs yard-backend | tail -40; exit 1; }
