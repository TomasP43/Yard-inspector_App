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
# table_type: information_schema.tables tambien lista las VIEW, y la 002 crea
# v_fotos_pendientes. Sin este filtro el conteo da 12 y el chequeo falla.
chequear "tablas creadas" "$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME:-yard}' AND table_type='BASE TABLE'")" "11"
chequear "vistas creadas" "$(sql "SELECT COUNT(*) FROM information_schema.views WHERE table_schema='${DB_NAME:-yard}'")" "2"
chequear "columnas de desvios de usuario" "$(sql "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='${DB_NAME:-yard}' AND table_name='desvio_catalogo' AND column_name IN ('creado_por_usuario_id','creado_en','revisar')")" "3"

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
echo "== Datos historicos migrados =="
chequear "inspecciones de appsheet"  "$(sql "SELECT COUNT(*) FROM inspeccion WHERE origen='appsheet'")" "4018"
chequear "  de las cuales OK"        "$(sql "SELECT COUNT(*) FROM inspeccion WHERE origen='appsheet' AND resultado='OK'")" "721"
chequear "  de las cuales NG"        "$(sql "SELECT COUNT(*) FROM inspeccion WHERE origen='appsheet' AND resultado='NG'")" "3297"
chequear "equipos"                   "$(sql 'SELECT COUNT(*) FROM equipo')" "569"
chequear "vinculos de desvio"        "$(sql 'SELECT COUNT(*) FROM inspeccion_desvio')" "3609"
chequear "fotos pendientes de copiar" "$(sql 'SELECT COUNT(*) FROM v_fotos_pendientes')" "4810"
chequear "checklists referenciados"  "$(sql 'SELECT COUNT(*) FROM inspeccion WHERE foto_checklist_origen IS NOT NULL')" "3937"

# Si algun subselect del ETL no encontro su catalogo, quedo un NULL donde no debia.
chequear "sin responsable huerfano"  "$(sql "SELECT COUNT(*) FROM inspeccion WHERE origen='appsheet' AND responsable_id IS NULL")" "0"
chequear "sin auditor huerfano"      "$(sql "SELECT COUNT(*) FROM inspeccion WHERE origen='appsheet' AND auditor_id IS NULL")" "0"
chequear "todo NG tiene desvio"      "$(sql "SELECT COUNT(*) FROM inspeccion i WHERE i.origen='appsheet' AND i.resultado='NG' AND NOT EXISTS (SELECT 1 FROM inspeccion_desvio d WHERE d.inspeccion_id=i.id)")" "0"
chequear "acentos en datos migrados" "$(sql "SELECT COUNT(*) FROM desvio_catalogo WHERE nombre LIKE '%Ã%'")" "0"

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

# Lo que pide la app de verdad. El front nuevo no llama a /hoy: Tablero y Hoy
# salen de esta ventana, que ademas trae los OK. Sin este chequeo, verificar.sh
# probaba endpoints que la PWA ya no usa y no probaba los que si.
DESDE=$(date -u -d '2 days ago' +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -v-2d +%Y-%m-%dT00:00:00Z)
chequear "ventana por fecha (tablero y hoy)" \
  "$(curl -s "$API/api/inspecciones?desde=$DESDE&limite=500" | grep -c "$UUID")" "1"
chequear "  y respeta el corte: nada de 2029" \
  "$(curl -s "$API/api/inspecciones?desde=2029-01-01T00:00:00Z&limite=500" | grep -c "$UUID")" "0"

echo
echo "== Desvios fuera del catalogo =="
# La colacion de la tabla ignora acentos: pedir el desvio sin tilde tiene que
# devolver el que ya existe, no crear uno nuevo.
c=$(curl -s -X POST "$API/api/desvios" -H 'Content-Type: application/json' -d '{"nombre":"Oxido en batea"}')
chequear "'Oxido' sin tilde reusa el existente" "$(echo "$c" | grep -c '"yaExistia":true')" "1"

# Un nombre parecido pero no igual tiene que frenar y sugerir, no crear.
c=$(curl -s -o /tmp/y3.json -w '%{http_code}' -X POST "$API/api/desvios" \
  -H 'Content-Type: application/json' -d '{"nombre":"Oxido en la batea del acoplado"}')
chequear "un parecido devuelve 409 con sugerencias" "$c" "409"
chequear "  y trae candidatos" "$(grep -c '"similares"' /tmp/y3.json)" "1"

# Confirmando, se crea y queda marcado para revision.
curl -s -o /dev/null -X POST "$API/api/desvios" -H 'Content-Type: application/json' \
  -d '{"nombre":"Desvio de prueba verificar","confirmar":true}'
chequear "creado y marcado para revisar" "$(sql "SELECT revisar FROM desvio_catalogo WHERE nombre='Desvio de prueba verificar'")" "1"
chequear "aparece en la cola de revision" "$(sql "SELECT COUNT(*) FROM v_desvios_a_revisar WHERE nombre='Desvio de prueba verificar'")" "1"
sql "DELETE FROM desvio_catalogo WHERE nombre='Desvio de prueba verificar'" >/dev/null 2>&1
chequear "historial por camion" "$(curl -s "$API/api/inspecciones?equipo=9999" | grep -c "$UUID")" "1"

# Un OK no debe aparecer en la patrulla del dia
UUID_OK="11111111-2222-3333-4444-5555555555aa"
sql "DELETE FROM inspeccion WHERE uuid='$UUID_OK'" >/dev/null 2>&1
payload_ok=$(printf '{"uuid":"%s","registrado_en":"%s","responsable_id":%s,"equipo_codigo":9999,"resultado":"OK"}' \
  "$UUID_OK" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RESP_ID")
curl -s -o /dev/null -X POST "$API/api/inspecciones" -H 'Content-Type: application/json' -d "$payload_ok"
chequear "el OK NO aparece en la patrulla del dia" "$(curl -s "$API/api/inspecciones/hoy" | grep -c "$UUID_OK")" "0"
chequear "el OK SI aparece en el historial" "$(curl -s "$API/api/inspecciones?equipo=9999" | grep -c "$UUID_OK")" "1"

# El detalle por equipo: es la pantalla que se abre tocando cualquier fila.
resumen=$(curl -s "$API/api/inspecciones/equipo/9999")
chequear "resumen del equipo cuenta los dos" "$(echo "$resumen" | grep -c '"total":2')" "1"
chequear "  y separa el NG del OK" "$(echo "$resumen" | grep -c '"ng":1')" "1"
chequear "equipo inexistente da 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/api/inspecciones/equipo/987654")" "404"

echo
echo "==> Limpiando datos de prueba"
sql "DELETE FROM inspeccion WHERE uuid IN ('$UUID','$UUID_OK')" >/dev/null 2>&1
sql "DELETE FROM equipo WHERE codigo=9999" >/dev/null 2>&1

echo
echo "======================================"
printf "  OK: %s   FALLAS: %s\n" "$ok" "$fallo"
echo "======================================"
[ "$fallo" -eq 0 ] || { echo; echo "Logs del backend:"; $COMPOSE logs yard-backend | tail -40; exit 1; }
