# Yard Inspector

App con la que los inspectores de playa cargan observaciones (patrullas) sobre camiones y bateas en **TTFA**.

Reemplaza la app de **AppSheet** que corre hoy sobre un Google Form + Sheets, y se despliega en el VPS de la empresa junto a `ttfa-docker`, siguiendo el mismo patrón que `tenko-docker`.

> **Estado: desplegado** en el VPS vía Coolify, en `/yard/`.

---

## Qué hace

Cuatro pantallas, según el diseño del proyecto de Claude Design **"UI mockups pending details"**:

| Pantalla | Qué muestra |
|---|---|
| **Tablero** | Controles y NG de hoy, tasa NG del período, barras por jornada, desglose por tipo de control, desvíos más frecuentes y equipos que repiten |
| **Hoy** | Los controles de la jornada agrupados por turno, con filtro Todos / Solo NG |
| **Historial** | Todo, con chips por tipo de control |
| **Cargar** | El formulario: equipo, tráfico, qué pasó con lo que quedó abierto, resultado, tipo, zona, desvío, fotos |

Y tocando cualquier fila se abre el **detalle del equipo**: sus KPIs, el desvío que se le repite y su historial completo.

Tres cosas que en AppSheet no existían: el tablero, el detalle por equipo, y que antes de cargar un control nuevo haya que decir qué pasó con el NG anterior.

Los inspectores trabajan **sin conexión**. En la playa la señal se corta, así que la app guarda las inspecciones en el dispositivo y las sincroniza cuando vuelve la señal.

## Stack

| Capa | Tecnología |
|---|---|
| Backend | Node.js 22 + Express 4 |
| DB | MySQL 8.0 (contenedor propio, `db_yard`) |
| ORM | Sequelize 6 |
| Frontend | PWA vanilla (service worker + IndexedDB) |
| Imágenes | sharp |
| Infra | Docker Compose |

## Arrancar

```bash
git clone https://github.com/TomasP43/Yard-inspector_App.git
```

```bash
cp .env.example .env
```

Completá las passwords en `.env` y levantá:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

- App: http://localhost:3002 · DB expuesta en `:3309`
- En desarrollo **no hay login**: el usuario se simula con `DEV_USER_EMAIL`
- Si no tenés `ttfa-docker` corriendo, la red `proxy_net` no existe y el `up` falla. Ver el comentario al final de `docker-compose.dev.yml`

Las migraciones las aplica **el backend al arrancar**, llevando registro en `migracion_aplicada`. Agregar una es dejar el `.sql` en `migrations/`. Para rehacer la base desde cero: `docker compose down -v`. Ver [CLAUDE.md](CLAUDE.md#migraciones) para el detalle.

## Mirar el front sin levantar nada

No hace falta Docker ni la base: `tools/preview/` monta una copia de la PWA con datos falsos que imitan la forma real de la API.

```bash
bash tools/preview/armar.sh
```

```bash
perl tools/preview/serve.pl .preview 4173
```

Y abrís http://127.0.0.1:4173/. `.preview/` está en `.gitignore` y se regenera entera en cada corrida, así que nunca queda vieja.

## Verificar que quedó bien

```bash
bash verificar.sh
```

Chequeo de humo completo: esquema, catálogos, el `CHECK` constraint, la API, los 4.018 registros migrados y —lo que más importa— que **reenviar una inspección no la duplique**. Reporta OK/FALLA por línea.

## Estructura

```
├── node/
│   ├── src/            # API Express + Sequelize
│   └── public/         # PWA (app shell, service worker, cola)
├── migrations/         # 001 esquema · 002 fotos · 003 histórico · 004 desvíos
├── tools/
│   ├── preview/        # mirar el front con datos falsos
│   └── ...             # ETL y migración de fotos desde AppSheet
├── verificar.sh
├── DECISIONS.md        # por qué el proyecto es como es
└── CLAUDE.md           # decisiones de diseño en detalle
```

## El modelo de datos

El origen era una tabla plana de 13 columnas. Los cambios grandes:

- **`Timestamp` era la primary key.** Dos inspectores guardando en el mismo segundo colisionaban. Ahora hay `id` propio más un `uuid` generado en el dispositivo, que además hace idempotente la cola offline.
- **`Desvio` era un `EnumList` separado por coma** (278 filas con más de uno). Pasa a tabla puente: contar "cuántos óxidos hubo" ya no requiere parsear strings.
- **`Fotografias del desvio 2` no era una foto del desvío**, sino el *Checklist Batea (Vertical)*, presente en el 100% de los OK.
- **El campo `Controlador` mezclaba personas con estados** (`Controlado`, `Solicitado controlar en TASA`). Se separan.
- **53 de 77 desvíos tenían más de un tipo asignado** según quién los cargara, lo que rompía cualquier métrica. El catálogo ahora trae un tipo por defecto que prellena el formulario.

El detalle completo, con los números, está en [CLAUDE.md](CLAUDE.md).

## Datos históricos

Migrados **4.018 registros** (721 OK, 3.297 NG, feb-2025 a ago-2026) sobre 569 camiones. Las 34 filas descartadas no tenían Timestamp ni ningún otro campo.

Las **8.747 fotos** siguen en Google Drive. Sus registros ya están migrados apuntando a dónde estaban, con `ruta` en NULL — la vista `v_fotos_pendientes` lleva la cuenta. Se traen de Drive directo al VPS con `rclone`; el procedimiento está en [tools/README.md](tools/README.md).

## Integración con ttfa-docker

No hay login propio: se usa la sesión de `ttfa` vía nginx `auth_request`, igual que TENKO.

Lo que hay que pedirle a quien maneja `ttfa-docker`:

- Publicar `/yard/` **por HTTPS** — sin contexto seguro no hay service worker, y sin service worker no hay offline
- Servir `/yard/sw.js` sin reescribir el path, o el service worker no puede controlar `/yard/`
- Crear el permiso `yard/view` en la tabla `permission`
