# Yard Inspector

App de los inspectores de playa de **TTFA**. Cuatro módulos en la misma PWA:
**patrullas** (observaciones sobre camiones y bateas), **control de bahías** (las
herramientas de cada bahía, una vez por turno), **inspección de precarga** (los
daños de cada unidad antes de la carga) y **recepción en destino** (con cuáles
llegó).

Reemplaza las apps de **AppSheet** que corren hoy sobre Google Forms + Sheets.

> **Estado: solo el front, hosteado en GitHub Pages.**
>
> **[Ver la demo](https://tomasp43.github.io/Yard-inspector_App/)** · [el tablero de gerencia](https://tomasp43.github.io/Yard-inspector_App/gerencia/)
>
> Corre con datos inventados: **no hay backend ni base andando en ningún lado**. El VPS con Coolify se dio de baja el 26-08-2026. El código de `node/src/` y las migraciones quedan como referencia de qué forma tienen las respuestas y qué reglas hay que respetar — ver [REQUERIMIENTOS.md](REQUERIMIENTOS.md).

---

## Qué hace

Dos frentes: la PWA del inspector y el tablero de gerencia, los dos diseñados en el proyecto de Claude Design **"UI mockups pending details"**.

### La del inspector — `/yard/`

Pensada para el teléfono. El cajón lateral cambia de módulo; la barra de abajo se mueve dentro del que esté abierto.

**Patrullas** — observaciones sobre camiones y bateas:

| Pantalla | Qué muestra |
|---|---|
| **Tablero** | Controles y NG de hoy, tasa NG del período, barras por jornada, desvíos más frecuentes y equipos que repiten |
| **Hoy** | Los controles de la jornada agrupados por turno, con buscador de equipo y filtro Todos / Solo NG / Solo OK |
| **Historial** | Todo, con el mismo buscador y filtros, y paginado |
| **Cargar** | El formulario: equipo, tráfico, qué pasó con lo que quedó abierto, resultado, zona, desvío, fotos |

Tocando cualquier fila se abre el **detalle del control**, y de ahí el **detalle del equipo**: sus KPIs, el desvío que se le repite y su historial.

**Control de bahías** — reemplaza el papel pegado en cada bahía. La ronda del turno, el checklist de 12 ítems con su cantidad estándar, y el historial como calendario del mes con matriz de bahías × ítems. Se entra desde la ronda y **el QR de la bahía habilita la carga**: el papel se llenaba en la oficina.

**Inspección de precarga** — reemplaza la carga de daños unidad por unidad. Las solicitudes de la jornada agrupadas por bahía, y la unidad se abre **escaneando la etiqueta de VIN que el auto trae de fábrica**, parado al lado del auto. De ahí sale el orden real de bajada, que en AppSheet se anotaba después.

**Recepción en destino** — cierra la cadena de custodia. Precarga registra con qué daños **salió** el auto; esto registra con cuáles **llegó**, y de la diferencia sale lo único que la operación no podía contestar: **entre qué dos puntos apareció la marca**. Antes de recibir hay que decir de cada daño de origen si **sigue** o se **reparó**, y hasta contestarlos todos no se puede guardar.

Tres cosas que en AppSheet no existían: el tablero, el detalle por equipo, y que antes de cargar un control nuevo haya que decir qué pasó con el NG anterior.

Los inspectores trabajan **sin conexión**. En la playa la señal se corta, así que la app guarda todo en el dispositivo y lo sincroniza cuando vuelve la señal — una sola cola para los cuatro módulos.

### La de gerencia — `/yard/gerencia/`

Pantalla ancha, de escritorio. La barra lateral conmuta entre **patrullas** y **precarga**; arriba se conmuta entre **anual** y **mensual**, y desde el gráfico de evolución se entra al detalle de un mes o de un día.

**Patrullas:**

| Bloque | Para qué |
|---|---|
| **KPIs** | Controles, tasa de observación, unidades retiradas y demoras, contra el mes anterior |
| **Evolución** | Barras de controles y NG, línea de retiros. Se toca un mes y se abre el detalle |
| **Pareto** | Qué desvíos concentran el 80% de las observaciones, con curva acumulada |
| **Impacto en la carga** | Cuántas observaciones frenan un camión, por tipo de control y por desvío |
| **Reincidencia** | Qué pasó después de cada observación, con watchlist de equipos que repiten |
| **Tráfico y auditores** | Tendencia por tráfico y volumen/detección de cada auditor |

**Precarga:** qué se daña (Pareto de partes y de tipos), cuánto se baja fuera del orden solicitado por transportista y por bahía, cuánto de lo pedido se llegó a registrar, y qué modelos y destinos concentran el daño.

**No calcula nada en el navegador.** Necesita agregados sobre el histórico completo, así que espera endpoints que devuelvan todo masticado: `YI-004` para patrullas y `YI-014` para precarga, en [REQUERIMIENTOS.md](REQUERIMIENTOS.md).

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

No hace falta Docker ni base: `tools/preview/` monta las dos pantallas con datos falsos que imitan la forma real de la API.

```bash
bash tools/preview/armar.sh
```

```bash
perl tools/preview/serve.pl .preview 4173
```

- PWA del inspector: http://127.0.0.1:4173/
- Tablero de gerencia: http://127.0.0.1:4173/gerencia/

`.preview/` está en `.gitignore` y se regenera entera en cada corrida, así que nunca queda vieja.

> El chequeo de humo contra el VPS (`verificar.sh`) sigue fuera del repo, para revisarlo con el equipo. Está en el historial de git.

## Estructura

```
├── node/
│   ├── src/            # API Express + Sequelize — referencia, no se toca
│   └── public/
│       ├── css/tokens.css   # paleta compartida por las dos pantallas
│       ├── js/danos.js      # el formulario del daño, que precarga y descarga comparten
│       ├── index.html …     # PWA del inspector (los cuatro módulos)
│       └── gerencia/        # tablero de gerencia
├── migrations/         # 001 esquema · 002 fotos · 003 histórico · 004 desvíos
├── tools/preview/      # mirar las dos pantallas con datos falsos
├── REQUERIMIENTOS.md   # lo que el backend tiene que dar
├── DECISIONS.md        # por qué el proyecto es como es
└── CLAUDE.md           # decisiones de diseño en detalle
```

## El modelo de datos

El origen era una tabla plana de 13 columnas. Los cambios grandes:

- **`Timestamp` era la primary key.** Dos inspectores guardando en el mismo segundo colisionaban. Ahora hay `id` propio más un `uuid` generado en el dispositivo, que además hace idempotente la cola offline.
- **`Desvio` era un `EnumList` separado por coma** (278 filas con más de uno). Pasa a tabla puente: contar "cuántos óxidos hubo" ya no requiere parsear strings.
- **`Fotografias del desvio 2` no era una foto del desvío**, sino el *Checklist Batea (Vertical)*, presente en el 100% de los OK.
- **El campo `Controlador` mezclaba personas con estados** (`Controlado`, `Solicitado controlar en TASA`). Se separan.
- **60 de 71 desvíos tenían más de un tipo asignado** según quién los cargara, sobre el 99% de los usos: el campo terminaba diciendo quién lo cargó, no qué se encontró. **Se sacó** (`YI-008`). La pregunta la contesta el Pareto por desvío, que dice *cuál* en vez de *de qué tipo*.

El detalle completo, con los números, está en [CLAUDE.md](CLAUDE.md).

## Datos históricos

Migrados **4.018 registros** (721 OK, 3.297 NG, feb-2025 a ago-2026) sobre 569 camiones. Las 34 filas descartadas no tenían Timestamp ni ningún otro campo.

Las **8.747 fotos** siguen en Google Drive. Sus registros ya están migrados apuntando a dónde estaban, con `ruta` en NULL — la vista `v_fotos_pendientes` lleva la cuenta. Se traen de Drive directo al VPS con `rclone`; el procedimiento estaba en `tools/README.md`, que salió del repo el 26-08-2026 y está en el historial de git.

## Integración con ttfa-docker

No hay login propio: se usa la sesión de `ttfa` vía nginx `auth_request`, igual que TENKO.

Lo que hay que pedirle a quien maneja `ttfa-docker`:

- Publicar `/yard/` **por HTTPS** — sin contexto seguro no hay service worker, y sin service worker no hay offline
- Servir `/yard/sw.js` sin reescribir el path, o el service worker no puede controlar `/yard/`
- Crear el permiso `yard/view` en la tabla `permission`
