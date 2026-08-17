# yard-inspector

App donde los inspectores de playa cargan observaciones (patrullas) sobre camiones y bateas. Reemplaza la app de **AppSheet** que corre hoy sobre un Google Form + Sheets. Se despliega como servicio independiente en el mismo VPS que **ttfa-docker**, siguiendo el mismo patron que `tenko-docker`.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Node.js 22 + Express 4 |
| DB | MySQL 8.0 (contenedor propio, `db_yard`) |
| ORM | Sequelize 6 |
| Frontend | PWA (vanilla JS, service worker + IndexedDB) |
| Imagenes | sharp (redimension server-side) |
| Infra | Docker Compose |

## Por que PWA y no un panel comun

En la playa **la senal se corta**. El inspector tiene que poder cargar la observacion sin conexion y que se sincronice sola despues. Eso obliga a:

- Service worker que cachea el app shell, para que la app abra offline.
- IndexedDB como cola de inspecciones pendientes, incluyendo las fotos como Blob.
- Compresion de la foto en el celular **antes** de encolar. Una foto de camara son ~4 MB; sin comprimir, tres fotos por inspeccion llenan la cuota de IndexedDB y la sincronizacion tarda una eternidad sobre 3G.
- `uuid` generado en el dispositivo como clave de idempotencia: reintentar la cola no puede duplicar registros.

## Conexion con ttfa-docker

Igual que TENKO: **no hay login propio**, se usa la sesion de ttfa.

- La app (`/yard/`) solo es accesible con sesion activa en ttfa.
- nginx de ttfa intercepta con `auth_request` contra `GET /api/login/verify`.
- La comunicacion va por la red Docker `proxy_net`, declarada por ttfa.
- El acceso se controla con el permiso `yard / view` en la tabla `permission` de ttfa.

**Diferencia importante con TENKO:** `auth_request` solo responde 200/401, no dice quien es el usuario. Como el campo Auditor sale del usuario logueado (en AppSheet era `USEREMAIL()`), el backend ademas consulta `TTFA_VERIFY_URL` para obtener el email. Ver `src/helpers/auth.js`.

**Ojo con la sesion vencida durante el offline.** La API devuelve `401 {"error":"sesion_invalida"}` en JSON en vez de redirigir al login. Si redirigiera, el `fetch` del service worker recibiria un 200 con el HTML del login y daria la sincronizacion por exitosa, **borrando de la cola inspecciones que nunca se guardaron**.

**La app necesita HTTPS.** Sin contexto seguro no hay service worker, y sin service worker no hay offline. Si nginx la publica por http en una IP interna, la PWA se degrada a una web comun.

## Regla de la cola de sincronizacion

Una inspeccion **solo sale de la cola cuando el servidor confirma que la guardo**. Los finales posibles:

| Respuesta | Que hace la cola |
|---|---|
| 201 / 200 | Guardada. Se saca de la cola |
| 401 | Frena todo y avisa. No descarta nada |
| 4xx de validacion | Marca la inspeccion como rechazada y la muestra, pero **no la borra**: que la vea una persona antes de perder trabajo de campo |
| 5xx o error de red | Queda encolada, se reintenta |

El `uuid` lo genera el dispositivo antes de sincronizar, y `POST /api/inspecciones` es idempotente sobre esa clave: reintentar devuelve 200 con el registro que ya existe, no un 409. Con un 409 el cliente no sabria si puede sacarlo de la cola.

## Estructura

```
yard-inspector/
├── node/
│   ├── src/
│   │   ├── controllers/
│   │   ├── routes/          # inspecciones, catalogos
│   │   ├── services/
│   │   ├── helpers/auth.js  # identidad apoyada en ttfa
│   │   ├── database/models/
│   │   └── index.js
│   ├── public/
│   │   ├── index.html       # app shell: 3 vistas + formulario
│   │   ├── sw.js            # service worker
│   │   ├── js/db.js         # IndexedDB: catalogos, cola, cache
│   │   ├── js/camera.js     # captura y compresion de fotos
│   │   ├── js/sync.js       # cola de sincronizacion
│   │   └── js/app.js        # UI
│   └── Dockerfile
├── migrations/
│   └── 001_initial.sql
├── docker-compose.yml
├── docker-compose.dev.yml
└── .env.example
```

## Modelo de datos

El origen era una tabla plana de 13 columnas. Lo que cambio y por que:

| AppSheet | Ahora | Motivo |
|---|---|---|
| `Timestamp` era la KEY | `id` + `uuid` | Dos inspectores guardando en el mismo segundo colisionaban |
| `Desvio` (EnumList, coma) | tabla `inspeccion_desvio` | 278 filas traen mas de un desvio; era imposible contar sin parsear strings |
| `Fotografias del desvio 2` | `inspeccion.foto_checklist` | **No era una foto del desvio**: es el Checklist Batea (Vertical), presente en el 100% de los OK |
| `Fotografias del desvio` 1 y 3 | tabla `inspeccion_foto` | Cantidad variable |
| `Fecha` | (derivada) | Duplicaba `Timestamp` |
| `Controlador` con valores como "Controlado" | `estado_control` | Eso es un estado, no una persona |

El **tipo de desvio** se sigue guardando por inspeccion, pero el catalogo trae un tipo por defecto: en el historico 53 de 77 desvios tenian mas de un tipo asignado segun quien lo cargara, lo que rompia cualquier metrica.

## Desvios que el inspector agrega

Si aparece algo que no esta en la lista, el inspector lo escribe y queda en el catalogo para todos. Para que eso no repita el desorden de AppSheet (78 grafias para 71 conceptos) hay dos controles, y hacen cosas distintas a proposito:

| Caso | Quien lo resuelve |
|---|---|
| Mismo nombre con otro acento o mayusculas | **La base**. La colacion `utf8mb4_0900_ai_ci` es insensible a acentos y mayusculas, asi que el UNIQUE sobre `nombre` ya hace chocar `Oxido en batea` con `Óxido en batea` |
| Parecido pero no igual | **El inspector**. Se le muestran los candidatos antes de crear. Si crea igual, queda con `revisar=1` |

**Nunca se fusiona por parecido.** `Matafuego vencido` y `Matafuego descargado` comparten casi todo y son cosas distintas. Un duplicado visible se arregla despues; un desvio absorbido dentro de otro no se recupera.

El desvio nuevo **viaja como texto junto a la inspeccion**, no como id: se puede escribir sin senal, cuando no hay forma de consultar el catalogo. Lo resuelve el servidor al sincronizar, dentro de la misma transaccion — si la inspeccion falla, no queda un desvio suelto en el catalogo sin nada que lo use.

La comprobacion de parecidos esta duplicada en `public/js/similitud.js` y `src/services/desvioService.js`. Es a proposito: el cliente necesita hacerla offline. **Si cambias la formula de un lado, cambiala del otro**, o la app va a sugerir cosas distintas de las que el servidor termina haciendo.

## Desarrollo local

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- App: http://localhost:3002
- DB expuesta en `:3309`
- En dev **no hay login**: el usuario se simula con `DEV_USER_EMAIL`.
- Si no tenes `ttfa-docker` corriendo, la red `proxy_net` no existe y el `up` falla. Ver el comentario al final de `docker-compose.dev.yml`.

## Modulo de inspeccion de unidades

Segundo modulo, en la misma base y reusando `usuario`. Se monta en `/yard/unidades/` con el permiso `yard/unidades`.

**Este modulo no parsea el TXT de carga.** Lo hace el sistema de solicitudes, que migra otro equipo, y nos manda las unidades ya resueltas. Por eso la entrada esta detras de `src/services/ingesta/`: cuando cierren el contrato se escribe un adaptador y no se toca ni el modelo ni la API de inspeccion.

### Contrato de entrada

```
POST /api/unidades/ingesta
Authorization: Bearer <INGESTA_TOKEN>

{
  "playa": "ZAR",                     // codigo: SOR, IND, ZAR
  "flujo": "TASA - TCL",              // nombre del flujo, o su id
  "referencia_externa": "SOL-000123", // id de la solicitud en su sistema
  "fecha": "2026-08-16",
  "equipo_codigo": 3595,
  "unidades": [
    { "vin": "8AJBA3CD4T8003610", "modelo": "Hilux", "katashiki": "GUN126L-DGTHXG",
      "secuencia": 1, "orden_bajada": 3, "destino": "TCL", "so": "..." }
  ]
}
```

Es **idempotente sobre `(playa, referencia_externa)`**: reenviar la misma solicitud actualiza el viaje en vez de duplicarlo, asi que reintentar es seguro.

La respuesta trae `avisos` con lo que no es un error pero alguien tiene que ver: modelos o destinos que no estan en el catalogo, VIN repetidos en el envio, unidades que el origen dejo de mandar.

**Una unidad que ya tiene inspecciones nunca se borra**, aunque el origen la saque de la lista: se avisa y se conserva. Perder el trabajo de un inspector porque otro sistema cambio de opinion no es aceptable.

Es servidor a servidor, sin sesion de ttfa, asi que va con token. **Si `INGESTA_TOKEN` no esta configurado el endpoint responde 503 y queda deshabilitado, no abierto**: un endpoint que escribe viajes no puede quedar sin proteccion por un olvido en el `.env`.

### El cuadrante

Cada pieza se subdivide en una grilla numerada, segun el estandar de localizacion de danos 2024: **9 cuadrantes** para superficies grandes (puertas, techo, capot, paragolpes, guardabarros), **3** para pilares, rieles y zocalos, **1** donde no aplica. Lo lleva `parte.cantidad_cuadrantes`, que decide que grilla dibuja la pantalla y valida lo que se carga — hay 148 filas en el historico de AppSheet con cuadrantes que esa pieza no tiene.

No confundir con gravedad: el check list en papel codificaba `AREA - DANO - GRAVEDAD`, pero **ese proceso ya no esta vigente** y el tamano del dano no se registra. Ver `migrations/007`.

### Idiomas

La app va a estar en castellano, portugues e ingles. Los catalogos guardan el nombre canonico en castellano (es lo que viene de AppSheet) y las traducciones van en la tabla `traduccion`, generica para los ocho catalogos: sumar un idioma es insertar filas, no un `ALTER` en cada tabla.

## Migraciones

Las aplica **el backend al arrancar** (`src/database/migrar.js`), que lleva registro en la tabla `migracion_aplicada`. Agregar una migracion es dejar el `.sql` en `migrations/`: se aplica sola en el proximo deploy.

**No van montadas en `/docker-entrypoint-initdb.d`, a proposito.** Ese mecanismo solo corre la primera vez que se crea el volumen; con la base ya existente, toda migracion nueva quedaba sin aplicar y el codigo terminaba buscando tablas inexistentes. Con el deploy automatico eso se rompe en silencio en cada push. Un solo mecanismo, no dos.

Dos cosas que el runner resuelve y conviene no romper:

- **Cada archivo corre sobre una sola conexion.** `003_datos_historicos.sql` encadena `SET @i = LAST_INSERT_ID()` entre sentencias, y `@i` es de sesion: repartir las sentencias entre conexiones del pool cargaria las inspecciones sin sus desvios ni sus fotos, sin fallar.
- **Entiende `DELIMITER`**, que es una instruccion del cliente mysql y no SQL. Sin eso, el `;` de adentro de un trigger corta la sentencia al medio.

Sobre bases anteriores a este runner, la primera corrida marca como aplicadas las migraciones hasta `MIGRACION_BASELINE` (por defecto la 004) sin ejecutarlas, porque ya estaban cargadas por el mecanismo viejo.

Para rehacer la base desde cero: `docker compose down -v`.

## Qué requiere cambios en ttfa-docker

| Tarea | Por que toca ttfa |
|---|---|
| Publicar `/yard/` | El routing y el `auth_request` estan en `nginx/proxy.prod.conf` de ttfa |
| Dar acceso a los inspectores | El permiso `yard/view` vive en la tabla `permission` de ttfa |
| Que el service worker tenga scope | nginx tiene que servir `/yard/sw.js` sin reescribir el path, o el SW no puede controlar `/yard/` |
