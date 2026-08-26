# Requerimientos hacia el backend

**Acá se trabaja el front.** Todo lo que la app necesita y el backend hoy no da
se anota en este archivo en vez de implementarse, para que quien conecte a
producción sepa qué falta y por qué.

El backend que existe en `node/src/` queda como **referencia**: dice qué forma
tienen las respuestas y qué reglas hay que respetar. No se le agregan cosas
nuevas desde acá.

La lógica que la app implementa —reglas de la cola, idempotencia, similitud,
deduplicación del catálogo, las trampas de los datos— está en
[CLAUDE.md](CLAUDE.md) y [DECISIONS.md](DECISIONS.md).

## Formato

```md
### YI-000 — Título corto
- **Estado:** pendiente | resuelto | descartado
- **Prioridad:** bloqueante | importante | menor
- **Tipo:** endpoint | campo de datos | migración | otro
- **Qué necesito:** una o dos frases.
- **Para qué:** qué parte de la pantalla lo usa y qué pasa si no está.
- **Forma esperada:** el request y el response que asume el front.
- **Mientras tanto:** cómo se las arregla la app hoy.
```

---

## Pendientes

### YI-001 — Filtrar el historial por tipo de control
- **Estado:** pendiente
- **Prioridad:** importante
- **Tipo:** endpoint
- **Qué necesito:** que `GET /api/inspecciones` acepte `?tipo=<id>` y filtre del
  lado del servidor.
- **Para qué:** los chips de la pantalla Historial (5s / Mantenimiento /
  Seguridad / Calidad). Hoy filtra por `resultado`, por rango de fechas y por
  `equipo`, pero no por tipo.
- **Forma esperada:** `GET /api/inspecciones?tipo=3&limite=50&offset=0`, con el
  id de `tipo_desvio`. Un `tipo` no numérico debería dar `400 { error:
  "tipo_invalido" }`. Un OK no tiene tipo, así que el filtro ya deja afuera los
  OK sin que haga falta pedir `resultado=NG` además.
- **Mientras tanto:** el front pide `resultado=NG` —solo los NG tienen tipo, así
  achica lo que viaja— y filtra el tipo sobre lo que llegó. El texto de arriba
  dice sobre qué está contando: *"12 de Seguridad en los 50 NG más recientes"*
  mientras es parcial, y *"38 de Seguridad"* cuando ya se trajo todo.

  Es una muleta honesta, no una solución: con muchas jornadas cargadas, ver el
  total real de un tipo obliga a apretar "cargar más" varias veces.

  > El problema original era peor y ya está arreglado: decía **"376 controles
  > registrados"** al lado de una lista de 7, y se leía como que en Seguridad
  > había 376.

---

### YI-002 — Guardar la resolución del NG anterior
- **Estado:** pendiente
- **Prioridad:** importante
- **Tipo:** migración
- **Qué necesito:** una tabla donde quede registrado que un desvío abierto se
  cerró: cuál, en qué control se cerró, cuándo y quién.
- **Para qué:** el formulario ya le pregunta al inspector qué pasó con cada
  desvío que quedó abierto —**se corrigió** o **sigue**— y usa la respuesta para
  premarcar el control nuevo. Pero esa respuesta **no se guarda en ningún lado**.

  Consecuencias hoy:
  - No se puede medir cuánto tarda en cerrarse un desvío.
  - No se distingue un desvío que reincidió de uno que aparece por primera vez.
  - El detalle del equipo no puede mostrar "esto se resolvió el 14/08".

  El dato se está recogiendo y tirando, que es lo que más molesta.
- **Forma esperada:** algo como
  `resolucion_desvio (inspeccion_origen_id, desvio_id, inspeccion_cierre_id,
  resuelto, usuario_id, creado_en)`, más el `POST` aceptando un array
  `resoluciones: [{ desvio_id, resuelto: bool }]`.
- **Ojo:** sería la migración **009**. Los números 005 a 008 quedaron quemados en
  `migracion_aplicada` por el módulo de unidades que se sacó del repo — si se
  reusa uno, el runner lo da por aplicado y no lo ejecuta nunca.
- **Mientras tanto:** la resolución se refleja de forma implícita: si el
  inspector dice "sigue", el desvío queda marcado en el control nuevo; si dice
  "se corrigió", simplemente no aparece. Funciona para el inspector, no sirve
  para medir nada.

---

### YI-003 — Tipografías del design system, servidas por nosotros
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** otro
- **Qué necesito:** los `.woff2` de **Archivo** y **IBM Plex Mono** servidos
  desde el mismo origen, en vez de traerlos de Google Fonts.
- **Para qué:** la app tiene que abrir sin conexión. Hoy las fuentes vienen de
  `fonts.googleapis.com`: sin señal no llegan y la app cae a la pila del
  sistema. Sigue legible —está puesto `display=swap` y hay respaldo declarado—
  pero no se ve como el diseño. Y un pedido a un dominio de afuera puede no
  pasar la política de la intranet.
- **Forma esperada:** los archivos en `node/public/fonts/`, un `@font-face`
  local en `css/app.css`, y las rutas sumadas al `SHELL` del service worker para
  que queden cacheadas.
- **Mientras tanto:** Google Fonts con `display=swap` y respaldo del sistema. No
  bloquea el pintado.

---


### YI-004 — Un endpoint agregado para el tablero de gerencia
- **Estado:** pendiente
- **Prioridad:** bloqueante
- **Tipo:** endpoint
- **Qué necesito:** `GET api/tablero?periodo=anual|mensual`, devolviendo todo ya
  calculado.
- **Para qué:** el tablero entero. **Esto no se puede calcular en el navegador**,
  y no es una preferencia: son 4.268 controles sobre 12 meses, más un Pareto
  acumulado, un análisis de reincidencia (qué pasó en el control siguiente de
  cada equipo) y el cruce de cada desvío con su desenlace de carga. La API de
  inspecciones corta en 500 filas por consulta y no tiene agregación.
- **Por qué el período va como parámetro:** el corte no cambia solo el gráfico
  de arriba. El Pareto de los últimos 12 meses no es el del mes en curso, y los
  KPIs comparan contra cosas distintas (mes anterior vs. nada).
- **Forma esperada:**

  ```
  {
    meta:   { total, updated, curMonthLabel, priorMonthLabel },
    annual: { series[], total, rechazo, stats },
    monthly:{ series[], stats, priorStats, priorTotal },

    monthDetail: { "2026-08": { label, n, ng, rechazo, ngTracked,
                                topDesvios[], topEquipos[], rechazoList[] } },
    dayDetail:   { "2026-08-26": { label, n, ng, rechazo,
                                   rows[{ time, eq, trafico, cat, ng, desvio }] } },

    catCounts:  [[tipo, n], ...],
    impacto:    { total, outcome[{key,n}], cats[], topFreno[], trend[] },
    reincidencia: { corregido, reincidio, sinRecontrol, tasa, medianaDias,
                    watchTotal, watchlist[] },
    traficoTrend: [{ name, totalN, monthly[{label,n,pct}] }],
    auditorBench: { teamPct, list[{name,n,ng,pct}] },
    pendientes:   [{ eq, desvio, date }],
    todayFeed:    [{ time, eq, trafico, cat, ng, desvio }],
    todayCount, todayNg
  }

  series[] = [{ label, clave, n, ng, ngPct, rechazo, rechazoPct }]
  stats    = { n, ngTracked, ngPct, okPct, rechazo, demoraCarga, criticoPct,
               pareto[{ name, count, cumPct }] }
  ```

  La forma exacta, con datos, está en `tools/preview/mock-gerencia.js`.

- **⚠ Ojo con esto:** `ngPct` tiene que poder venir **`null`**, y no cero. Antes
  de junio de 2026 no se distinguía OK de NG, así que esos meses **no tienen**
  tasa de observación. La pantalla lo muestra como "sin tracking"; si el backend
  manda 0, va a decir que esos meses salieron todos perfectos.

- **`clave` en `series[]`** es lo que ata cada barra con su entrada en
  `monthDetail` / `dayDetail`. Sin eso el drill-down no puede resolver qué
  abrió el usuario.

- **Mientras tanto:** `tools/preview/mock-gerencia.js` define `window.TABLERO`
  con esta forma y `js/datos.js` lo usa si está. El `// TODO` con el path real
  ya está puesto.

---

### YI-005 — "Almirón" y "Almiron" son la misma persona
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** campo de datos
- **Qué necesito:** fusionar los dos usuarios en la tabla `usuario`.
- **Para qué:** el bloque de Auditores del tablero los muestra como dos personas
  distintas, una con 692 controles y otra con 14. Es la misma, escrita con y sin
  tilde.
- **Antecedente:** en la migración del histórico ya se fusionaron casos así en
  `controlador` (`Codero` → `Cordero`). En `usuario` quedó sin hacer.
- **Mientras tanto:** el mock reproduce el caso a propósito, para que se vea.

---

## Nota sobre lo que el backend tiene y la app no usa

No es un requerimiento, es para que nadie los tome por carga viva:

- `GET /api/inspecciones/hoy` — la PWA ya no lo llama. Tablero y Hoy salen de
  una sola consulta con `?desde=`, que además trae los OK.
- `GET /api/desvios/similares` y `POST /api/desvios` — el front tampoco los
  llama. Un desvío nuevo viaja como **texto junto a la inspección** y lo resuelve
  el servidor al sincronizar, porque se escribe sin señal. Las rutas quedan como
  versión autoritativa de la comprobación de parecidos, que
  `public/js/similitud.js` espeja para poder sugerir offline.

Los dos están marcados con un comentario en su router.

---
