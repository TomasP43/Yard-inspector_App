# yard-inspector

App donde los inspectores de playa cargan observaciones (patrullas) sobre camiones y bateas. Reemplaza la app de **AppSheet** que corre hoy sobre un Google Form + Sheets.

**Donde corre hoy: solo el front, en GitHub Pages, con datos inventados.**

- https://tomasp43.github.io/Yard-inspector_App/ — la PWA del inspector
- https://tomasp43.github.io/Yard-inspector_App/gerencia/ — el tablero

Hubo un despliegue completo en un VPS con Coolify, detras del `auth_request` de ttfa. **Se dio de baja el 26-08-2026** y el workflow que lo disparaba salio del repo. Hoy **no hay backend ni base andando en ningun lado**: `node/src/`, `migrations/` y los compose quedan como referencia de que forma tienen las respuestas y que reglas hay que respetar, no como algo que este corriendo.

Lo que el front necesita del backend esta en `REQUERIMIENTOS.md`.

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
│   ├── public/
│   │   ├── index.html       # PWA del inspector, en /yard/
│   │   ├── sw.js            # service worker (scope /yard/)
│   │   ├── manifest.json
│   │   ├── css/tokens.css   # paleta TTFA, la comparten las dos pantallas
│   │   ├── css/app.css      # layout de la PWA
│   │   ├── js/iconos.js     # glifos de Lucide, inline
│   │   ├── js/zonas.js      # agrupa el catalogo por parte del equipo
│   │   ├── js/db.js         # IndexedDB: catalogos, cola, cache
│   │   ├── js/camera.js     # captura y compresion de fotos
│   │   ├── js/similitud.js  # espejo cliente de desvioService
│   │   ├── js/sync.js       # cola de sincronizacion
│   │   ├── js/app.js        # UI
│   │   └── gerencia/        # tablero de gerencia, en /yard/gerencia/
│   │       ├── index.html
│   │       ├── css/gerencia.css
│   │       ├── js/datos.js  # la unica costura con el backend
│   │       └── js/app.js
│   └── Dockerfile
├── migrations/              # 001 esquema · 002 fotos · 003 historico · 004 desvios
├── tools/preview/           # mirar las dos pantallas con datos falsos
├── REQUERIMIENTOS.md        # lo que el backend tiene que dar
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

**El tipo de desvio se saco** (YI-008). Se guardaba por inspeccion y era el ejemplo de manual de un campo que mide al que lo carga: 60 de 71 desvios se cargaron con mas de un tipo, sobre el 99% de los usos. La columna y la tabla quedan quietas en la base; el front no las manda ni las muestra.

## Desvios que el inspector NO agrega

**El boton "No esta en la lista" se saco.** Dejaba escribir un desvio nuevo, se le mostraban los parecidos antes de crear, y viajaba como texto junto a la inspeccion para que lo resolviera el servidor. Todo ese aparato existia para contener el desorden que produce dejar escribir: AppSheet llego con **78 grafias para 71 conceptos**.

Contener no alcanzo. Ahora directamente no se puede crear: lo que no esta en el catalogo se carga como **"Faltante sin clasificar"** —esta en la zona Otros— y lo que se encontro se describe en el campo **Observacion**. Despues alguien lo mira y decide si merece entrar al catalogo.

Es el mismo poka-yoke que con el tipo de control: sin la opcion, no hay forma de equivocarse. El costo es que agregar un desvio deja de ser instantaneo; a cambio el catalogo deja de crecer solo.

**Nunca se fusiona por parecido**, y eso no cambio. `Matafuego vencido` y `Matafuego descargado` comparten casi todo y son cosas distintas. Las fusiones de la familia oxido/suciedad (YI-007) las decidio una persona que conoce la operacion, que es el unico caso que la regla admite.

**`js/similitud.js` sigue en el SHELL aunque nadie cree desvios**, y no es descuido: `zonas.js` lo usa para normalizar y enganchar el catalogo con el mapa de zonas. `Oxido en batea` del catalogo tiene que enganchar con `Óxido en batea` del mapa o **todo el catalogo cae en "Otros"**. Lo saque una vez pensando que habia quedado sin uso y me llevo puesta la app entera.

## El front

Cuatro pantallas y un detalle, segun el diseño del proyecto de Claude Design **"UI mockups pending details"** (`Yard Inspector.dc.html`), que usa el design system **TTFA**:

| Pantalla | Que hace |
|---|---|
| **Tablero** | Controles y NG de hoy, tasa NG del periodo, barras por jornada, desvios mas frecuentes, equipos que repiten |
| **Hoy** | Los controles de la jornada agrupados por turno, con filtro Todos / Solo NG |
| **Historial** | Todo, con dos filtros (Todos / Solo NG) y paginado |
| **Cargar** | El formulario |
| **Detalle del control** | Se abre tocando cualquier fila de Hoy o del Historial: que se cargo en ese control puntual, con sus fotos y su resolucion. Desde aca se salta al historial del equipo, y se agrega una observacion sobre el mismo equipo |
| **Detalle del equipo** | KPIs del equipo, desvio recurrente y su historial completo |

Tres cosas del design system **no se portaron tal cual, a proposito**:

- **Los iconos van inline** (`js/iconos.js`) y no como mascara CSS contra el CDN de Lucide. Sin conexion la app tiene que abrir igual, y un pedido a un dominio de afuera no pasa la politica de la intranet.
- **Los tokens se copian** en `css/app.css` en vez de importarse. Mismo motivo.
- **Hay modo claro**, que el diseño no tiene. Esto se usa al sol; una pantalla oscura ahi se lee mucho peor. El boton esta en el menu lateral, no en la barra.

### El formulario

El camino es: equipo y trafico → *que paso con lo que quedo abierto* → resultado → zona → desvio → fotos.

**El "tipo de control" se saco** (YI-008). Medido sobre el historico, 60 de 71 desvios se habian cargado con mas de un tipo y el 99% de los usos caia sobre esos: el campo terminaba diciendo quien lo cargo, no que se encontro. Se evaluo derivarlo del desvio como poka-yoke y se descarto -- 37 de los 71 no tenian un tipo dominante claro, asi que la clasificacion seguia siendo discutible. La pregunta operativa la contesta el Pareto por desvio, que dice **cual** en vez de **de que tipo**.

Dos partes que no existian en AppSheet:

- **Las zonas** (`js/zonas.js`). El catalogo son ~70 nombres en una lista plana; buscar ahi adentro, de pie y con guantes, era el paso mas lento. Agrupados por parte del equipo son dos toques. **El catalogo manda, no la lista**: lo que este en la base y no figure mapeado cae en "Otros", que es como sigue siendo elegible un desvio que agrega un inspector sin tocar codigo. Vive en el cliente porque es presentacion, no dato; si algun dia se administra desde un panel, pasa a ser una columna `zona` en `desvio_catalogo`.
- **La resolucion del NG anterior.** Si el ultimo control de ese equipo fue NG, antes de nada hay que decir que paso con cada desvio: corrigio o reincidio. Reincidio lo vuelve a marcar solo y salta a su zona. Hasta contestar eso el boton de guardar esta bloqueado — si se pudiera saltear, el NG viejo queda colgado para siempre, que es justo lo que el paso vino a evitar.

Los campos que el diseño no muestra (`controlador`, `estado_control`) **no se sacaron**: quedan plegados en "Mas datos del control". La operacion los sigue usando; lo que cambio es que ya no estorban el camino rapido.

## El viaje cierra con la jornada

Un control puede salir OK y que despues aparezca algo. Desde el detalle del control hay un boton que abre el formulario precargado con ese equipo y **carga un control nuevo**: a la hora en que se cargo el primero, el equipo estaba OK, y eso fue cierto.

**Ese boton solo aparece en los controles de hoy.** La observacion pertenece al viaje, y cuando termina la jornada el viaje cerro: el camion ya salio. Sumarle algo despues seria decir que se vio lo que no se vio. En un control viejo, donde iba el boton queda el aviso de que el viaje cerro.

Lo que aparezca despues vuelve por el otro camino: **la proxima vez que ese equipo se controle**, si quedo algo abierto, el paso de resolucion lo trae de vuelta. Esa es la unica via para tocar un desvio de un viaje anterior, y es a proposito.

Enlazar el control que corrige con el corregido esta pedido en YI-009. Sin eso los dos cuentan como controles separados, que es defendible -- son dos revisiones del mismo camion -- pero sube el denominador y el numerador de la jornada.

## El tablero de gerencia

Segunda pantalla, en `/yard/gerencia/`. Portada del diseño **"Dashboard Gerencia"** del mismo proyecto de Claude Design. Es de escritorio: barra lateral, conmutador anual/mensual, y drill-down desde el grafico al detalle de un mes o de un dia.

**No calcula ni una metrica en el navegador**, y eso es una diferencia de fondo con la PWA. El tablero de la PWA agrega en el cliente porque son dos inspectores y una decena de controles por jornada. Este necesita agregados sobre el historico completo — 4.268 controles, Pareto acumulado, analisis de reincidencia, cruce de cada desvio con su desenlace de carga. La API de inspecciones corta en 500 filas y no tiene agregacion.

Por eso hay un solo pedido, `GET api/tablero?periodo=`, con el contrato en `REQUERIMIENTOS.md` (YI-004). Toda la costura esta en `gerencia/js/datos.js`: conectar el tablero es cambiar ese archivo.

**Una trampa del dato que hay que respetar: hasta jun-2026 el OK no se cargaba.** El formulario se llenaba solo cuando habia algo para reportar, asi que esas 2.809 filas son **100% NG** — verificado contra `003_datos_historicos.sql`, el primer OK del historico es de junio de 2026. No es que no se distinguiera OK de NG: es que el OK no existia como registro.

Eso obliga a tres cantidades y no dos: `volumen` (camiones movidos, siempre se sabe), `ng` (observaciones, siempre se sabe) y `n` (controles, **solo desde jul-2026**). Los meses viejos van con `n: null` — ni cero, que diria que no se controlo nada, ni `n = ng`, que diria que todo control termino mal. Lo que falta es el denominador.

**`volumen` no es el total de la tabla de operaciones: sale el flujo `Puerto / Cruce`**, que no entra a la playa y no se patrulla — 66% del volumen total con 11 controles en tres meses. La prueba esta en jul-2026, el unico mes limpio: con Puerto/Cruce adentro la cobertura da 32%, sacandolo da **99%**. `CAT·Puerto` si queda, que ese trafico se controla.

**Desde jul-2026 se controla todo lo que se mueve: `n === volumen`.** Los dos campos siguen separados igual, porque el historico los necesita distintos y porque hacia adelante la cobertura pasa de salvedad a **metrica de vigilancia** — un mes que baje de 100% es que se dejo de controlar algo.

Por eso el grafico mide **siempre sobre camiones movidos**: la barra es el total movido y el rojo es la parte observada, dos colores y un solo significado, con la fraccion roja siendo la tasa. Es la unica serie comparable los doce meses. La tasa sobre controles existe —49% en julio— pero solo desde jul-2026, y vive en los KPIs, nunca en la serie: una linea que cambiara de denominador en el medio saltaria de 12% a 49% por cambio de metodo y no de calidad. Ver YI-004 y YI-006 en `REQUERIMIENTOS.md`.

Los dos frentes comparten `css/tokens.css` — la paleta — y `js/iconos.js`. **No comparten layout**: uno es un telefono con barra fija abajo y el otro una pantalla de 1440 con barra lateral. Mezclarlos daba colisiones tontas, como el `main { position: fixed }` de la PWA comiendose el scroll del tablero.

### Como mirar el front andando

```bash
bash tools/preview/armar.sh && perl tools/preview/serve.pl .preview 4173
```

Monta las dos pantallas con datos falsos, sin Docker ni base — alcanza perl. La PWA en `/` y el tablero en `/gerencia/`.

**Usalo.** Los bugs mas caros de este proyecto **pasaron todos los chequeos estaticos y se veian a simple vista**: el 502 por una ruta mal resuelta, el helper de IndexedDB que devolvia el request en vez del resultado, los modales que tapaban la pantalla, tres promesas que no se resolvian nunca, y el tablero scrolleando la pagina entera en vez del panel. Ninguno daba error en consola.

Dos reglas del harness, aprendidas a los golpes:

- **El mock tiene que responder con la forma real de la API, incluidos los POST.** El de la PWA atrapaba los POST con un handler de listado y devolvia 200: la carga *parecia* andar sin probar nada.
- **El mock no puede portarse mejor que produccion.** Llego a filtrar por tipo cuando el backend no lo hace, y eso escondia justo el problema que habia que ver.

`verificar.sh`, el chequeo de humo contra el VPS, sigue fuera del repo para revisarlo con el equipo. Esta en el historial de git.

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
