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
│   │   ├── controllers/     # inspecciones, catalogos
│   │   ├── routes/
│   │   ├── services/        # fotoService, desvioService
│   │   ├── helpers/auth.js  # identidad apoyada en ttfa
│   │   ├── database/        # models, migrar.js
│   │   └── index.js
│   ├── public/              # la PWA, servida en /yard/
│   │   ├── index.html       # app shell: 4 pantallas + detalle
│   │   ├── sw.js            # service worker (scope /yard/)
│   │   ├── manifest.json
│   │   ├── css/app.css      # tokens del design system TTFA
│   │   ├── js/iconos.js     # glifos de Lucide, inline
│   │   ├── js/zonas.js      # agrupa el catalogo por parte del equipo
│   │   ├── js/db.js         # IndexedDB: catalogos, cola, cache
│   │   ├── js/camera.js     # captura y compresion de fotos
│   │   ├── js/similitud.js  # espejo cliente de desvioService
│   │   ├── js/sync.js       # cola de sincronizacion
│   │   └── js/app.js        # UI
│   └── Dockerfile
├── migrations/              # 001 esquema · 002 fotos · 003 historico · 004 desvios
├── tools/
│   ├── preview/             # mirar el front con datos falsos
│   └── ...                  # ETL desde AppSheet y traida de fotos
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

## El front

Cuatro pantallas y un detalle, segun el diseño del proyecto de Claude Design **"UI mockups pending details"** (`Yard Inspector.dc.html`), que usa el design system **TTFA**:

| Pantalla | Que hace |
|---|---|
| **Tablero** | Controles y NG de hoy, tasa NG del periodo, barras por jornada, desglose por tipo de control, desvios mas frecuentes, equipos que repiten |
| **Hoy** | Los controles de la jornada agrupados por turno, con filtro Todos / Solo NG |
| **Historial** | Todo, con chips por tipo de control y paginado |
| **Cargar** | El formulario |
| **Detalle** | Se abre tocando cualquier fila: KPIs del equipo, desvio recurrente y su historial completo |

Tres cosas del design system **no se portaron tal cual, a proposito**:

- **Los iconos van inline** (`js/iconos.js`) y no como mascara CSS contra el CDN de Lucide. Sin conexion la app tiene que abrir igual, y un pedido a un dominio de afuera no pasa la politica de la intranet.
- **Los tokens se copian** en `css/app.css` en vez de importarse. Mismo motivo.
- **Hay modo claro**, que el diseño no tiene. Esto se usa al sol; una pantalla oscura ahi se lee mucho peor. El boton esta en el menu lateral, no en la barra.

### El formulario

El camino es: equipo y trafico → *que paso con lo que quedo abierto* → resultado → tipo de control → zona → desvio → fotos.

Dos partes que no existian en AppSheet:

- **Las zonas** (`js/zonas.js`). El catalogo son ~70 nombres en una lista plana; buscar ahi adentro, de pie y con guantes, era el paso mas lento. Agrupados por parte del equipo son dos toques. **El catalogo manda, no la lista**: lo que este en la base y no figure mapeado cae en "Otros", que es como sigue siendo elegible un desvio que agrega un inspector sin tocar codigo. Vive en el cliente porque es presentacion, no dato; si algun dia se administra desde un panel, pasa a ser una columna `zona` en `desvio_catalogo`.
- **La resolucion del NG anterior.** Si el ultimo control de ese equipo fue NG, antes de nada hay que decir que paso con cada desvio: corrigio o reincidio. Reincidio lo vuelve a marcar solo y salta a su zona. Hasta contestar eso el boton de guardar esta bloqueado — si se pudiera saltear, el NG viejo queda colgado para siempre, que es justo lo que el paso vino a evitar.

Los campos que el diseño no muestra (`controlador`, `estado_control`) **no se sacaron**: quedan plegados en "Mas datos del control". La operacion los sigue usando; lo que cambio es que ya no estorban el camino rapido.

### Mirar el front sin levantar nada

No hace falta Docker ni la base. `js/mock.js` + `data/patrulla-data.js` (los datos del mockup) interceptan `fetch` y devuelven la forma real de la API:

```bash
bash tools/preview/armar.sh && perl tools/preview/serve.pl .preview 4173
```

`.preview/` esta en `.gitignore`. **Es la unica forma que hay hoy de ver la app antes de desplegarla**, y vale la pena usarla: los tres bugs mas caros del proyecto (el 502, el helper de IndexedDB, los modales que tapaban la pantalla) pasaron todos los chequeos estaticos y se veian a simple vista.

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

**La proxima migracion es la 009.** Los numeros 005 a 008 fueron del modulo de unidades, que se saco del repo: los archivos ya no estan, pero las bases donde alcanzaron a correr los tienen anotados en `migracion_aplicada`. Reusar uno de esos numeros para algo de patrullas haria que el runner lo diera por aplicado y no lo ejecutara nunca.

Para rehacer la base desde cero: `docker compose down -v`.

## Qué requiere cambios en ttfa-docker

| Tarea | Por que toca ttfa |
|---|---|
| Publicar `/yard/` | El routing y el `auth_request` estan en `nginx/proxy.prod.conf` de ttfa |
| Dar acceso a los inspectores | El permiso `yard/view` vive en la tabla `permission` de ttfa |
| Que el service worker tenga scope | nginx tiene que servir `/yard/sw.js` sin reescribir el path, o el SW no puede controlar `/yard/` |
