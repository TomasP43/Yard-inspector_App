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
│   ├── public/              # PWA: app shell, service worker, cola IndexedDB
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

## Desarrollo local

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- App: http://localhost:3002
- DB expuesta en `:3309`
- En dev **no hay login**: el usuario se simula con `DEV_USER_EMAIL`.
- Si no tenes `ttfa-docker` corriendo, la red `proxy_net` no existe y el `up` falla. Ver el comentario al final de `docker-compose.dev.yml`.

Las migraciones de `migrations/` corren solas **la primera vez que se crea el volumen** `yard_db`. Si ya existe, no se ejecutan: para rehacer la base, `docker compose down -v`.

## Qué requiere cambios en ttfa-docker

| Tarea | Por que toca ttfa |
|---|---|
| Publicar `/yard/` | El routing y el `auth_request` estan en `nginx/proxy.prod.conf` de ttfa |
| Dar acceso a los inspectores | El permiso `yard/view` vive en la tabla `permission` de ttfa |
| Que el service worker tenga scope | nginx tiene que servir `/yard/sw.js` sin reescribir el path, o el SW no puede controlar `/yard/` |
