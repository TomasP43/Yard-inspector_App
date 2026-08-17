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
