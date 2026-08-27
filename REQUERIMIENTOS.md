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
- **Estado:** ~~pendiente~~ **sin efecto**. Se cae con YI-008: el campo "tipo de
  control" se sacó, así que los cuatro chips del Historial ya no existen y no
  hay nada que filtrar. Quedan tres filtros — Todos, Solo NG y Solo OK — y los
  resuelve el backend con `resultado`, que ya acepta `OK` y `NG`.

  El buscador de equipo del Historial también va al servidor: `&equipo=<codigo>`
  sobre `GET /api/inspecciones`, que ya está en el contrato. En **Hoy** filtra
  el cliente, sobre lo que ya está en IndexedDB, porque tiene que andar sin
  señal.

  Queda anotado por lo que enseñó, que sigue valiendo: el front filtraba sobre
  lo que ya había llegado y el número de arriba decía **"376 controles
  registrados"** al lado de una lista de 7. Un filtro parcial tiene que decir
  sobre qué está contando.

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

    monthDetail: { "2026-08": { label, volumen, n, ng, rechazo, demora,
                                topDesvios[], topEquipos[], rechazoList[] } },
    dayDetail:   { "2026-08-26": { label, volumen, n, ng, rechazo, demora,
                                   rows[{ time, eq, trafico, ng, desvio }] } },

    empresas:   [{ name, volumen, ng, pct, pareto[], paretoAparte }],
    impacto:    { total, outcome[{key,n}], topFreno[], trend[] },
    reincidencia: { excluye, oxidoActivo{ equipos, deTotal },
                    corregido, reincidio, sinRecontrol, tasa, medianaDias,
                    watchTotal, watchlist[] },
    traficoTrend: [{ name, totalN, monthly[{label,n,pct}] }],
    auditorBench: { teamPct, list[{name,n,ng,pct}] },
    pendientes:   [{ eq, desvio, date }],
    todayFeed:    [{ time, eq, trafico, ng, desvio }],
    todayCount, todayNg
  }

  series[] = [{ label, clave, volumen, n, ng, obsPct,
                rechazo, rechazoPct, retiroZ }]
  stats    = { volumen, observaciones, obsPct, n, mesesConControles, ngPct,
               okPct, rechazo, demoraCarga, retiroProm,
               embudo{ meses, volumen, n, ng, rechazo, demora },
               pareto[{ name, count, cumPct }] }
  ```

  La forma exacta, con datos, está en `tools/preview/mock-gerencia.js`.

- **⚠ Lo más importante de todo el contrato: hay tres cantidades, no dos.**

  | Campo | Qué es | Cuándo se conoce |
  |---|---|---|
  | `volumen` | camiones movidos **por la playa** ese mes | siempre — sale de operaciones, no de la patrulla |
  | `ng` | observaciones cargadas | siempre |
  | `n` | controles hechos, OK + NG | **solo desde jul-2026** |

  **⚠ `volumen` NO es el total de la tabla de operaciones: hay que sacarle el
  flujo `Puerto / Cruce`** (`Furlong·Puerto` + `Furlong·Cruce`). Son movimientos
  que **no entran a la playa** y por lo tanto no se patrullan nunca: son el 66%
  del volumen total con 11 controles en tres meses.

  Con ellos adentro, cualquier tasa queda diluida por tráfico que nadie
  inspecciona. La prueba está en jul-2026, el único mes limpio que hay — con OK
  ya cargado y sin cortes de fecha:

  ```
  con Puerto/Cruce:   684 controles / 2120 movidos =  32%
  sin Puerto/Cruce:   684 controles /  691 movidos =  99%   ← este
  ```

  `CAT·Puerto` **sí queda adentro**: pese al nombre, ese tráfico se controla
  (37% de cobertura en jun–ago 2026).

  **Desde jul-2026 se controla todo lo que se mueve, así que `n === volumen`.**
  Los dos campos siguen existiendo por separado a propósito: el histórico
  necesita distinguirlos, y hacia adelante la cobertura (`n / volumen`) deja de
  ser una salvedad del dato viejo y pasa a ser **algo que hay que vigilar** — si
  un mes baja de 100%, se dejó de controlar algo y conviene que se note.

  **Hasta jun-2026 el OK no se cargaba.** El formulario se llenaba únicamente
  cuando había algo para reportar, así que esas 2.809 filas son 100% NG y no se
  sabe sobre cuántos controles salieron. Verificado contra
  `003_datos_historicos.sql`: el primer OK del histórico es de junio de 2026, y
  todos los meses anteriores dan 100% NG sin una sola excepción.

  Esos meses van con **`n: null`**. Ni cero (diría que no se controló nada) ni
  `n = ng` (diría que todo control terminó mal). Lo que falta es el denominador.

- **Dos tasas, y no se mezclan nunca.**

  | Campo | Cuenta | Dónde se usa |
  |---|---|---|
  | `obsPct` = `ng / volumen` | los doce meses | el gráfico y el KPI |
  | `ngPct` = `ng / n` | solo donde hay controles | el pie del KPI, dicho sobre cuántos meses sale |

  El gráfico usa **siempre** `obsPct`. Es la única comparable de punta a punta.
  Una serie que cambiara de denominador en jul-2026 saltaría de 12% a 49% por
  cambio de método, no de calidad, y quien la mirara rápido leería un derrumbe
  que no ocurrió.

  La barra tiene dos colores y un solo significado: el alto es `volumen` y el
  rojo es `ng` dentro de ese total. La fracción roja **es** `obsPct`.

- **`embudo` son los cuatro KPIs de arriba, y es un embudo de verdad:**

  ```
  controles → con observación → de esos, cuántos se retiraron
                                y cuántos demoraron la carga
  ```

  Los cuatro van en números absolutos y los tres últimos se dividen por
  `embudo.n` (controles). Retiros y demoras son subconjuntos del NG, así que las
  tres tasas se comparan entre sí sin trampa.

  **⚠ Las cuatro cifras tienen que salir de los mismos meses.** Los controles
  existen solo desde que se cargan los OK: mezclar retiros de doce meses con
  controles de dos da un porcentaje que no es de nada. Por eso `embudo` cubre
  **el tramo con control cargado**, no la ventana entera, y `embudo.meses` dice
  cuántos son para que la pantalla lo pueda decir.

  Es el único bloque del tablero con un período distinto al del gráfico, y es a
  propósito: el gráfico puede medir los doce meses porque usa `volumen` de
  denominador, y este no.

  **El bloque sigue al mes elegido.** Al tocar una barra, los cuatro KPIs pasan
  a ser los de ese mes y salen de `monthDetail` / `dayDetail` — que por eso
  necesitan `demora` y `volumen`. En un mes sin controles, `n` viene `null`, los
  absolutos se siguen mostrando y los porcentajes van como `—`.

- **`retiroZ` es el semáforo de retiros, y no lleva ningún umbral fijo.** Es un
  gráfico de control por proporciones (p-chart): cuántos errores estándar separa
  la tasa del mes del promedio del período.

  ```
  p̄  = Σ rechazo / Σ volumen          ← ponderado, NO el promedio de los %
  σᵢ = sqrt( p̄ (1 - p̄) / volumenᵢ )   ← distinto para cada mes
  zᵢ = (rechazoᵢ / volumenᵢ - p̄) / σᵢ
  ```

  `retiroProm` es `p̄` en porcentaje, y la pantalla lo muestra al lado de los
  retiros: sin él, los colores de abajo salen de la nada.

  **Las dos cosas que hay que respetar:**

  - **σ depende del volumen del mes.** Un mes de 750 camiones rebota mucho más
    que uno de 2.600 sin que nada haya cambiado. Con datos reales: ene-2026
    tiene 12 retiros sobre 746 (1,61%) y jun-2026 tiene 41 sobre 2.407 (1,70%).
    Casi la misma tasa, pero z = +2,0 contra +4,1. Un umbral fijo los pintaría
    igual y no lo son.
  - **`p̄` va ponderado.** Promediar los doce porcentajes le da el mismo peso a
    un mes de 750 camiones que a uno de 2.600.

  Los cortes en el cliente son 1σ amarillo y 2σ rojo (`AMARILLO` y `ROJO` en
  `gerencia/js/app.js`), que es lo estándar: con un proceso estable serían ~27%
  de meses en amarillo y ~5% en rojo.

  **La limitación, para que nadie se sorprenda:** con promedio móvil de 12
  meses, un deterioro lento y sostenido se vuelve el promedio nuevo y deja de
  marcarse. Lo de manual es congelar los límites sobre un período estable de
  referencia; hoy no hay uno porque el proceso cambió en jun-2026. Conviene
  revisarlo cuando haya doce meses parejos.

- **`volumen` no sale de la base de patrullas.** Es el volumen operativo por mes,
  hoy en una tabla dinámica de Excel abierta por transportista y destino. El
  mapeo a los flujos de patrullas está resuelto y documentado en YI-006.

- **`reincidencia` va sin óxido, y la tasa tiene que salir del mismo universo
  que la watchlist.** El óxido es la mitad de los desvíos y se repite en casi
  todos los equipos: dentro, la watchlist es una lista de óxido y no se ve nada
  más. Si la lista excluyera y `tasa` no, serían dos cosas distintas en la misma
  tarjeta.

  `excluye` lleva el nombre de lo que se sacó, para que la pantalla lo diga — un
  filtro que no se ve es peor que no filtrar. Y `oxidoActivo` es lo único que
  esas filas aportaban: cuántos equipos lo tienen abierto ahora, sobre cuántos.

- **`empresas[]` es la tasa de NG por transportista, y cada una trae su propio
  corte.** `pct = ng / volumen` de **esa** empresa, no sobre el total: la
  pregunta es cuál anda peor, no cuál mueve más. Sin dividir por el volumen
  propio, la que más mueve encabeza siempre por ser la más grande.

  Cada entrada lleva además su `pareto` y su `paretoAparte`, porque al tocar una
  empresa el Pareto pasa a mostrar lo de ella. Son los mismos agregados que a
  nivel total, filtrados por empresa.

  **No es un gráfico de torta, y no puede serlo:** una torta reparte un total
  entre sus partes, y estas tasas tienen cada una su propio denominador — no
  suman 100. Van en barras, que además es lo que ya usa esa tarjeta.

- **`pareto` va SIN el óxido, y lo que se saca viaja en `paretoAparte`.**

  ```
  paretoAparte = { name, count, pct }   // pct = sobre el total CON óxido
  ```

  El óxido solo es más de la mitad de los desvíos: dentro de la tabla, el Pareto
  contesta siempre lo mismo y tapa a los otros diez, que son sobre los que se
  puede hacer algo distinto. La pantalla lo muestra como una llamada arriba a la
  izquierda con su peso, que es lo único que ese renglón aportaba.

  **`cumPct` se acumula sobre el total sin óxido**, porque es el porcentaje de
  lo que la tabla muestra. Acumulando sobre el total con óxido, la curva no
  podría llegar nunca al 100%.

- **`rechazoList` tiene que traer un ítem por cada retiro del mes**, o sea
  `rechazoList.length === rechazo`. El KPI de arriba muestra el total y la lista
  de abajo los detalla: si no coinciden, la misma pantalla se contradice. El
  mock llegó a decir "37 retiros" arriba y "Ningún retiro este mes" abajo.

  Si algún día hace falta recortarla por tamaño, **no la recortes en silencio**:
  la pantalla ya muestra "3 de 37" cuando difieren, pero eso es una red de
  seguridad, no el comportamiento buscado.

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

### YI-006 — El volumen de camiones movidos, por mes y por flujo
- **Estado:** pendiente
- **Prioridad:** **bloqueante** para la serie histórica del tablero
- **Tipo:** origen de datos nuevo
- **Qué necesito:** una fuente de `volumen` — camiones movidos por mes y por
  flujo — cargable desde jul-2024. Hoy vive en una tabla dinámica de Excel que
  mantiene operaciones; hay que decidir si se importa periódicamente a una tabla
  `volumen_mensual (anio, mes, flujo_id, camiones)` o si sale de un sistema.
- **Para qué:** es el único denominador que existe antes de jul-2026. Sin él,
  los meses en que solo se cargaba el NG no tienen contra qué medirse y el
  tablero no puede mostrar una serie comparable.

- **El mapeo ya está resuelto.** La tabla de operaciones cruza transportista ×
  destino; el campo `Responsable` de las patrullas mezcla las dos dimensiones en
  una sola lista. Cada columna cae en exactamente un flujo, ninguna se repite:

  | Flujo en patrullas | Columnas de operaciones |
  |---|---|
  | Trafico Brasil | Furlong·BR + TTFA·BR |
  | Trafico Autoport | Autoport·BR |
  | Trafico Chile | TTFA·CHI |
  | Trafico Green Mile | Green Mile·CHI |
  | Trafico CAT | CAT·Puerto |
  | Trafico Puerto / Cruce | Furlong·Puerto + Furlong·Cruce — **fuera de `volumen`** |
  | Trafico Paraguay | Furlong·Paraguay |
  | Trafico Bolivia | TTFA·Bolivia |
  | Trafico Uruguay | Furlong·Uruguay |

  `TTFA` y `Playa` no son carriles y no tienen volumen.

- **⚠ Dos cosas del dato que conviene no olvidar:**
  - Los valores traen decimales (`108,12`, `40,5`). Se redondean a la unidad.
  - **`Trafico Puerto / Cruce` queda fuera de `volumen`** — ver YI-004. No entra
    a la playa, así que no se patrulla: es el 66% del volumen total con 11
    controles en tres meses. Sacándolo, jul-2026 da 99% de cobertura.
  - **Agosto 2026 no sirve para medir cobertura.** Da 325 controles sobre 193
    movidos, o sea 168%, que es imposible: las patrullas llegan hasta el 13-ago
    y el volumen se exportó con otro corte. Los dos lados están cortados en
    fechas distintas.

---

### YI-007 — Limpieza de la familia óxido en el catálogo
- **Estado:** pendiente
- **Prioridad:** media
- **Tipo:** catálogo + migración de histórico
- **Qué necesito:** la familia óxido/suciedad queda en **dos** desvíos, *Óxido
  en batea* y *Suciedad en batea*. Los otros cuatro se reparten entre esos dos y
  se desactivan (`activo = 0`, **no** borrar: si alguna fila quedara apuntando,
  borrarlo la rompe).

  | Desvío | Usos | Qué se hace |
  |---|---|---|
  | Óxido en batea | 1.183 | queda |
  | Suciedad en batea | 486 | queda |
  | Óxido avanzado en batea | 337 | → *Óxido en batea* |
  | Suciedad avanzada en batea | 77 | → *Suciedad en batea* |
  | Óxido y suciedad en batea | 239 | → los dos (ver abajo) |
  | Oxido y suciedad avanzada | 3 | → los dos |

- **Para qué:** hoy el mismo concepto está repartido en seis renglones que
  cruzan tres dimensiones — qué es, qué tan grave, y si vienen juntos. La
  severidad no la distinguía nadie de forma consistente, y la combinación es
  redundante porque el campo ya es multivalor. Ninguno de los seis servía para
  decidir nada.

- **⚠ `Oxido y suciedad avanzada` es la que se escapa de cualquier búsqueda:**
  va sin tilde en *Óxido* y sin el *"en batea"* del final, así que no aparece
  filtrando por ninguno de los dos. Son 3 usos, pero es el ejemplo exacto de por
  qué el catálogo necesita esta limpieza.

- **⚠ Esto no es una fusión por parecido.** La regla del proyecto es que
  **nunca** se fusiona por similitud automática — `Matafuego vencido` y
  `Matafuego descargado` se parecen y son cosas distintas. Acá la fusión la
  decidió una persona que conoce la operación, que es exactamente el caso que la
  regla reserva. No habilita a que el sistema empiece a fusionar solo.

- **Mientras tanto:** el preview ya lo muestra fusionado. `js/zonas.js` dejó de
  mapearlo y `tools/preview/mock-gerencia.js` no lo genera, así que en la demo
  no aparece entre las opciones. **En producción sigue apareciendo hasta que se
  toque el catálogo**, porque el catálogo manda sobre el mapa de zonas.

- **Las dos combinaciones se parten en dos filas cada una.** El campo es
  multivalor: se cargan marcando *Óxido en batea* y *Suciedad en batea*.

  Para esas dos la migración **no es un `UPDATE`**, porque una fila pasa a ser
  dos:

  1. Por cada `inspeccion_desvio` que apunte a la combinación, insertar la fila
     de *Óxido en batea* y la de *Suciedad en batea* para esa inspección.
  2. **Saltear la que ya exista.** Hay inspecciones que tienen la combinación
     *y además* uno de los dos sueltos; sin el `INSERT IGNORE` (o el `NOT
     EXISTS`) la migración choca contra el UNIQUE de `(inspeccion_id,
     desvio_id)`.
  3. Recién entonces borrar las filas de la combinación y desactivar la entrada
     del catálogo.

  Ojo con el orden: si se borra antes de insertar, se pierde el vínculo y no hay
  cómo saber qué inspecciones lo tenían.

---

### YI-008 — Se saca el campo "tipo de control"
- **Estado:** hecho en el front, pendiente en el backend
- **Prioridad:** alta
- **Tipo:** campo de datos
- **Qué necesito:**
  1. Que `POST /api/inspecciones` **deje de esperar** `tipo_desvio_id` — el
     front ya no lo manda — y no falle si no viene.
  2. Sacar `catCounts`, `impacto.cats`, `criticoPct` y el `cat` de las filas de
     `dayDetail` y `todayFeed` de la respuesta de `GET api/tablero`.
  3. Decidir qué pasa con la columna `inspeccion.tipo_desvio_id` y la tabla
     `tipo_desvio`. **No hace falta borrarlas**: dejarlas quietas alcanza, y el
     histórico queda como está por si alguna vez sirve.

- **Por qué:** medido sobre el histórico, el campo no medía lo que decía medir.

  | | |
  |---|---|
  | Desvíos cargados con **más de un tipo** | **60 de 71** |
  | Usos sobre desvíos inconsistentes | **3.577 de 3.609 (99%)** |
  | Peor caso: *Rueda de auxilio en mal estado* | 4 tipos, el dominante 39% |
  | Aun *Óxido en batea*, con 1.183 usos | 4 tipos, el dominante 81% |

  El tipo terminaba diciendo **quién cargó la observación**, no qué se
  encontró. Y el 53% de todo cayó en "5s", que es el cajón donde va lo que no
  se sabe bien dónde poner.

- **Se evaluó derivarlo del desvío y se descartó.** La idea era cargar
  `desvio_catalogo.tipo_desvio_id` y que el tipo saliera de ahí, como
  poka-yoke: si el inspector no elige, no puede elegir mal. Se llegó a armar la
  propuesta de tipo para los 71 desvíos, agrupando por naturaleza del hallazgo.

  Se descartó porque **la clasificación seguía siendo una decisión discutible**:
  37 de los 71 no tenían un tipo dominante claro, y sostener una dimensión que
  hay que defender caso por caso no vale lo que aporta.

- **Qué se pierde, dicho de frente:** los tres bloques que colgaban del tipo —
  el desglose "Por tipo de control" en las dos pantallas, el "% que frena la
  carga por tipo" y el KPI "12% de los NG son de seguridad". La pregunta de
  cuánto de lo que se encuentra es seguridad deja de poder contestarse.

  A cambio, el resto del tablero deja de mezclar un dato que no era confiable
  con los que sí lo son, y el **Pareto por desvío** contesta la misma pregunta
  operativa sin necesidad de clasificar: dice *qué* desvío y no *de qué tipo*.

- **Mientras tanto:** el front ya no lo manda ni lo muestra. Si el backend sigue
  devolviendo `catCounts` y compañía, no rompe nada — la pantalla los ignora.

---

### YI-009 — Enlazar el control que corrige a otro anterior
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** campo de datos
- **Qué necesito:** un campo opcional en `inspeccion`, algo como
  `corrige_uuid`, y que el `POST` lo acepte.
- **Para qué:** un control puede salir OK y que **después** se le encuentre
  algo. La pantalla de detalle ya tiene el botón "Agregar observación a este
  equipo", que abre el formulario precargado y **carga un control nuevo**.

- **Por qué un control nuevo y no editar el anterior**, que es lo primero que
  uno piensa:
  - A la hora en que se cargó, el equipo **estaba** OK. Eso fue cierto y
    reescribirlo es perder la única información que hay sobre cuándo apareció
    el problema.
  - Editar un registro ya sincronizado pide un `PUT` con su propia semántica
    offline: qué pasa si el dispositivo edita algo que en el servidor ya cambió.
  - Rompe la idempotencia por `uuid` de la cola, que es lo que hoy garantiza
    que reintentar no duplique.

- **Qué falta sin el campo:** los dos controles quedan sueltos. Se ven los dos
  en el historial del equipo, con sus horas, así que la información **está** —
  lo que falta es poder decir "este corrige a aquel", y que el tablero pueda
  decidir si cuenta uno o dos controles para ese camión ese día.

- **Mientras tanto:** cuentan como dos controles, que es defendible — son dos
  revisiones del mismo camión en el día. Si eso infla la cobertura de forma
  molesta, este campo es la salida.

---

### YI-010 — "EPP fuera de lugar" pasa a cubrir al chofer sin EPP
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** catálogo
- **Qué necesito:** renombrar una fila de `desvio_catalogo`.

  ```sql
  UPDATE desvio_catalogo
     SET nombre = 'Chofer sin EPP / EPP fuera de lugar'
   WHERE nombre = 'EPP fuera de lugar';
  ```

- **Para qué:** de la playa llegó *"chofer sin EPP correspondiente"* y no había
  dónde cargarlo. El catálogo tiene ~70 desvíos y **ninguno sobre una persona**:
  son todos sobre el equipo — batea, cabina, matafuego, patente, bahía.
  `EPP fuera de lugar` se cargó como `5s`, al lado de *Residuos en bahía* y
  *Reposera / objetos no permitidos*: significa **el EPP tirado donde no va**,
  no el chofer sin ponérselo. Se usó 4 veces en 4.268 controles.

- **Por qué renombrar y no agregar una fila.** Se decidió que un solo renglón
  cubra las dos cosas. El costo está anotado y es real: el Pareto deja de poder
  distinguir un elemento mal guardado de una persona trabajando sin protección.
  Si esa diferencia empieza a importar, la salida es partirlo en dos entradas,
  no volver a la grafía vieja.

- **Es un `UPDATE`, no una fusión.** Ninguna fila de `inspeccion_desvio` se
  mueve: los 4 usos siguen apuntando al mismo `desvio_id`. No hay choque con el
  `UNIQUE (inspeccion_id, desvio_id)` ni histórico que reescribir. Puede viajar
  en la misma migración que YI-007, que también toca el catálogo.

- **⚠ No tocar `003_datos_historicos.sql`.** Sus `INSERT` buscan la fila por
  `nombre = 'EPP fuera de lugar'`, pero corren **antes** que el renombre, así
  que sobre una base nueva resuelven bien. Cambiarles el nombre para "dejarlos
  al día" los rompe.

- **Mientras tanto:** `js/zonas.js` ya usa el nombre nuevo y mantiene el viejo
  como alias, así que en producción el desvío sigue apareciendo en *Orden y
  documentación* con la etiqueta vieja hasta que corra el `UPDATE`. Sin ese
  alias se caía a "Otros", porque el catálogo manda sobre el mapa de zonas.

---

### YI-011 — Control de bahías
- **Estado:** pendiente · el front ya está armado y andando contra el mock
- **Prioridad:** alta
- **Tipo:** módulo nuevo — tablas, endpoints y migración

- **Qué reemplaza:** el papel que hoy vive pegado en cada bahía
  (`Control de bahías (Para impresión) - Google Sheets`). El problema del papel
  **no es que se pierda: es que se llena en la oficina sin ir a mirar** y
  después se deja en la bahía. Todo el diseño está puesto contra eso.

- **Tablas** (migración **009**; 005–008 los quemó el módulo de unidades):

  ```
  bahia               (id, codigo, nombre, token, activo)
  bahia_item          (id, nombre, cantidad_std, orden, activo)
  bahia_control       (id, uuid UNIQUE, bahia_id, turno_clave, inspector_id,
                       registrado_en, sincronizado_en, foto, observacion, estado)
  bahia_control_item  (control_id, item_id, conforme, cantidad,
                       ubicacion_ok, estado_ok, comentario)
  bahia_auditoria     (id, uuid UNIQUE, control_id, usuario_id,
                       registrado_en, coincide, observacion, foto)
  ```

  - `UNIQUE (bahia_id, turno_clave)` — una bahía se controla una vez por turno.
    El segundo intento es **409**, no un 200 silencioso.
  - `UNIQUE (uuid)` en control y auditoría: es la clave de idempotencia de la
    cola, igual que en inspecciones. Reenviar devuelve **200 con lo que ya
    existe**, nunca 409 — con un 409 el cliente no sabe si puede sacarlo de la
    cola.
  - `bahia.token` es lo que va impreso en el QR. **Aleatorio por bahía**, no
    derivable del código: si fuera `bahia-3`, se adivina sin ir.

- **⚠ El QR lleva SÓLO el token, nunca una URL.** Se entra desde la ronda y el
  escaneo va con la cámara **dentro de la app**; el QR habilita, no navega. Si
  el sticker llevara una URL, escanearlo con la cámara del sistema abriría la
  app por afuera del gate y el bloqueo sería decorativo. Con token pelado, la
  cámara del teléfono muestra un texto sin sentido.

  **Sin escanear no se carga, sin excepción.** Decisión tomada sabiendo el
  costo: un sticker mojado deja esa bahía sin poder controlarse hasta que lo
  reimpriman.

- **Son 8 bahías y se patrullan la 3 a la 8.** Las ocho van en la tabla; la 1 y
  la 2 con `activo = 0`. No se omiten: la numeración es física, y el día que se
  decida controlarlas es prender un flag, no renumerar. `GET api/bahias`
  devuelve solo las activas, y un POST sobre una inactiva contesta
  **409 `bahia_no_se_patrulla`** — no un 404, que el día que se prenda la 1
  nadie entendería por qué fallaba.

  Se imprimen **6 QR**, uno por bahía activa.

- **Falta la hoja para imprimir.** Cada bahía lleva un cartel fijo con el número
  grande y su QR. No se hizo todavía porque los tokens los genera el backend:
  sin tokens reales, la hoja sería de mentira. Cuando existan, es una página
  A4 por bahía con `@media print` — el QR se genera del `token`, sin servicio
  externo (la intranet no sale a internet).

- **Los 12 ítems del papel**, con su `cantidad_std`: Distance checkers 1 ·
  Almohadillas de puertas 1 · Soportes de carteles 1 · Arneses de seguridad 2 ·
  Reglas de medición 1 · Escaleras burro 4 · Recapados 2 · Portallaves 1 ·
  Stoppers bahías de carga 1 · Stoppers bahías de espera 1 · Rampas 1 ·
  Rampines 2.

  Se **cuenta**, no se tilda: tres escaleras burro de cuatro es un faltante que
  un checkbox no ve. Y por cada ítem van las tres columnas del papel —
  `cantidad`, `ubicacion_ok`, `estado_ok` — porque una herramienta completa en
  cantidad puede estar rota o fuera de lugar.

- **Endpoints:**

  | Método | Ruta | Qué hace |
  |---|---|---|
  | GET | `api/bahias?turno=<clave>` | Estado de la ronda de ese turno: `{turno, items[], bahias[]}`, cada bahía con su `control` o `null` |
  | POST | `api/bahias/control` | Alta de un control. Idempotente por `uuid` |
  | POST | `api/bahias/auditoria` | Alta de una auditoría sobre un control |
  | GET | `api/bahias/rondas?limite=` | Rondas de turnos cerrados |

- **⚠ `turno_clave` la manda el dispositivo y el servidor NO la recalcula.** Un
  control cargado a las 00:30 sin señal puede sincronizar a las 07:00: el turno
  al que pertenece es el que estaba abierto cuando se hizo, no el de la hora de
  llegada. Deducirlo del `registrado_en` en el servidor también funciona; lo que
  no puede es deducirlo de `NOW()`.

- **La foto es obligatoria en el servidor, no solo en el front.** Si la
  exigiera solo la pantalla, alcanzaría un POST a mano para saltearla — y la
  foto es la mitad de la prueba de que alguien fue.

- **⚠ El QR prueba que se vio el código, no que la persona estuvo ahí.** Un QR
  es una URL impresa: se fotografía una vez y se escanea desde la oficina. Lo
  que encarece mentir es la foto fresca **y que cualquiera puede escanear el
  mismo QR durante el turno y auditar parado en la bahía**. Si aun así siguen
  firmando sin ir, el escalón siguiente es NFC: hay que apoyar el teléfono en el
  tag y eso no se fotografía.

- **Falta definir** (ver el papel): la fila **5S** del final, y las dos firmas
  (**Firma TTFA** y **Firma Furlong**). El front todavía no las implementa.

---

### YI-012 — La jornada de patrullas no cruza la medianoche
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** agrupación en el front

- **Qué pasa:** el corte de turno ya es 16:00 y vive en `js/turnos.js`, que sabe
  que el segundo turno termina **00:45 del día siguiente**. Pero `claveDia()` en
  `app.js` sigue agrupando la pantalla Hoy por día de calendario, así que un
  control entre 00:00 y 00:45 se muestra bajo "Segundo turno" pero en el día
  nuevo, y a las 00:00 desaparece de Hoy el trabajo de las últimas horas.

- **Cuánto pesa:** **8 controles de 4.268** en todo el histórico están en 00:xx.
  Entre 01:00 y 05:00 no hay ninguno. Por eso no se cambió: mover la clave de
  día corre esos 8 controles de jornada y toca los números que gerencia ya vio,
  a cambio de casi nada.

- **La salida cuando haga falta:** usar `Turnos.de(x).clave` en vez de
  `claveDia(x)` para agrupar. La regla ya está escrita y probada — la usa el
  módulo de bahías, donde el límite de las 00:45 sí es el centro de todo.

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
