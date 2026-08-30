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

## Orden de trabajo de precarga

Sale del benchmark contra las apps de la categoria y del cotejo con el estandar
AIAG. **Uno por vez: se desarrolla, se valida corriendo, se commitea, y recien
ahi arranca el siguiente.**

| # | Que | Toca | Estado |
|---|---|---|---|
| 1 | ~~El borrador sobrevive a que se cierre la app~~ | front | **hecho** |
| 2 | ~~Buscar un VIN y ver todo su historial~~ | front + `YI-016` | **front hecho**, falta el endpoint |
| 3 | **Codigos AIAG y gravedad** | datos + front + `YI-015` | **hecho en el front** |
| 4 | ~~**PDF del legajo**~~ | front | **hecho**: imprimir → guardar PDF |
| 5 | ~~Punto exacto sobre el esquema~~ | front | **no se hace**: la zona alcanza (D-020) |
| 6 | ~~**Captura guiada** de fotos~~ | front | **hecho**: avisa, no bloquea (D-019) |
| 7 | **Descarga en destino** | modulo nuevo | se planifica aparte |

El orden sale de **lo que cuesta no tenerlo**, no de lo que cuesta hacerlo.

**Fuera de alcance, decidido:** IA que detecta el daño sola, portico de escaneo,
grado de condicion y costo de reparacion, video 360, y accion correctiva. Decirlo
evita que vuelvan a aparecer en cada conversacion.

---

## Lo que hacen los que ya lo resolvieron

Salió de mirar software de **RoRo y terminales portuarias** y de **transporte
terrestre de autos**, que son las otras patas de la misma cadena. No hay nada
open source que sirva de base —el topic `vehicle-inspection` de GitHub son 29
repos y uno solo pasa de 2 estrellas— pero hay diseño para copiar.

### Dos cosas que corrigen lo que ya está hecho

**1. ⚠ M-22 va por la versión 6, y nosotros migramos a la 4.**
La 4.1 es la que el ECG publica gratis. AIAG anunció que la **v6 trae «revised
and reassigned damage codes» y «numerous changes to the Type and Area codes
listing»**. O sea: es exactamente el mismo error que acabamos de corregir, un
escalón más arriba. Hay que conseguir la v6 antes de que haya volumen cargado.
Confirmado de paso que **no hay estándar competidor**: AIAG-ECG son los únicos.

**2. Extender el estándar está bien. Pisarle los números, no.**
Las plataformas del rubro traen varios catálogos y dejan que cada organización
**extienda un estándar o arme uno propio**. O sea que la planilla de Furlong
haya sumado cuchetas, largueros y paneles de cabina **no es el error** — es lo
normal, porque M-22 no piensa en camiones. El error es que los metió en los
números 72–79, que el estándar ya usaba para neumáticos y llantas.

**La corrección no es dejar 26 partes sin código: es darles un espacio propio**
que no se confunda con el oficial —un prefijo, o un rango que M-22 no use— y que
el reporte externo mande el código oficial cuando existe y el propio cuando no.
Hoy quedan en `null`, que es seguro pero pierde información que la operación sí
tiene.

### Tres cosas para los puntos que faltan

| Punto | Lo que hacen | Qué nos ahorra |
|---|---|---|
| **5 · punto exacto** | Super Dispatch **marca el daño sobre la foto**, no sobre un esquema. Logisoft sí usa diagramas por panel: las dos formas conviven en el mercado | Anotar la foto **sale gratis** —ya es obligatoria por daño— y evita mapear 110 partes × 5 vistas × 8 modelos. Además es mejor prueba: es el daño, no un punto en una silueta genérica |
| **6 · captura guiada** | Dos escuelas. [Monk](https://github.com/monkvision/monkjs) muestra un **wireframe SVG del auto** y pide alinear, más chequeo de **desenfoque, exposición, ángulo y partes visibles**. Super Dispatch es más simple: **exige 6 fotos** en origen y 6 en destino, sin overlay | Se puede arrancar por la política —N ángulos fijos— y sumarle solo el chequeo de desenfoque, que son unas líneas de canvas. El overlay es una obra aparte |
| **7 · descarga en destino** | **Damage carry-forward**: «un golpe detectado en el portón queda en el registro en cada inspección siguiente hasta que se repara o se cierra». El inspector de destino **confirma, marca reparado o anota** — no vuelve a documentar | **Ya lo tenemos escrito, en otro módulo.** Es la resolución del NG anterior de patrullas. La descarga es el mismo paso con otro nombre |

**Y una que dejamos afuera y conviene revisar:** el rubro captura **firmas de
terceros** en el handheld del inspector —chofer, representante del cargador,
representante del consignatario— más **metadata ambiental** (luz, clima). Las
firmas se descartaron para precarga con buen motivo: el inspector sale de la
sesión de ttfa. Pero **en el traspaso son el punto**, porque ahí hay dos partes
que tienen que estar de acuerdo, y eso la sesión no lo prueba.

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

- **La hoja para imprimir ya está**, en `/yard/carteles/`. Una A4 por bahía con
  el número grande, el QR y la instrucción. Pide `GET api/bahias` para los
  tokens, así que lo único que falta del lado del backend es que existan.

  El QR se genera **en el navegador** (`carteles/qr.js`, escrito a mano): la
  intranet no sale a internet, así que no hay CDN ni servicio al que pedirle la
  imagen. Modo byte, versiones 1 a 4, corrección **nivel H (30%)** — el sticker
  vive en una playa y se ensucia.

  **La página no deja imprimir si el generador no pasa sus vectores de prueba**,
  y eso no es ceremonia: la primera versión salía perfectamente dibujada y
  **ningún lector la abría**, porque los bits de formato iban en orden inverso.
  Un QR roto se ve idéntico a uno bueno; el error habría aparecido con el
  sticker ya pegado y el inspector sin poder trabajar.

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

- **Dos cosas del papel que NO se portan, decidido con la operación:**
  - La fila **5S** del final: **no se usa más**. Quedó en el formulario impreso
    pero nadie la completa. No se implementa.
  - Las firmas **TTFA** y **Furlong**: **no van**. La app ya registra quién
    cargó con la sesión de ttfa, más la hora y la foto — es una prueba más
    fuerte que una firma dibujada con el dedo, que cualquiera puede garabatear.
    Si alguna vez auditoría las exige, es un pad en canvas y se guardan como
    imagen junto al control.

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

### YI-013 — Inspección de unidades en precarga
- **Estado:** pendiente · el front ya está armado y andando contra el mock
- **Prioridad:** alta
- **Tipo:** módulo nuevo — tablas, endpoints y migración

- **Qué reemplaza:** la app de **AppSheet** sobre `Base de datos bajada de carga`
  y `Estado de unidades Precarga`, donde hoy se cargan los daños de cada unidad
  antes de la carga. El camino de allá es: cargas por bahía → solicitud con sus
  VINs → unidad → inspección de daño.

- **Lo que cambia no es la pantalla, es dónde ocurre el registro.** En AppSheet
  el orden real de bajada era una columna `TASA` con `MAX(SELECT(Unidades[TASA]))+1`,
  que se llenaba después. Acá la unidad se abre **escaneando la etiqueta de VIN
  que el auto trae de fábrica**, parado al lado del auto, y de ahí sale el orden.

- **Tablas** (migración **009 o posterior**; 005–008 los quemó el módulo de
  unidades que se sacó del repo — reusar uno haría que el runner lo dé por
  aplicado y no lo ejecute nunca):

  ```
  precarga_solicitud   (id, codigo UNIQUE, jornada_clave, hora, transportista,
                        equipo, bahia, destino, cerrada)
  precarga_unidad      (id, solicitud_id, vin, orden_solicitado, so, katashiki,
                        modelo, destino, linea_txt)
  precarga_inspeccion  (id, uuid UNIQUE, unidad_id, inspector_id, escaneado_en,
                        registrado_en, sincronizado_en)
  precarga_dano        (id, inspeccion_id, parte_id, tipo_dano_id, comentario, foto)
  precarga_parte       (id, nombre, grupo, usos_historicos, orden, activo)
  precarga_tipo_dano   (id, nombre, usos_historicos, orden, activo)
  ```

  - `UNIQUE (solicitud_id, vin)` en `precarga_unidad`. El VIN **indexado pero no
    único a secas**: un mismo vehículo puede viajar más de una vez.
  - `UNIQUE (unidad_id)` en `precarga_inspeccion` — una unidad se inspecciona una
    vez por solicitud. El segundo intento con otro `uuid` es **409**.
  - `UNIQUE (uuid)` es la clave de idempotencia de la cola. Reenviar devuelve
    **200 con lo que ya existe, nunca 409** — con un 409 el cliente no sabe si
    puede sacarlo de la cola.

- **⚠ El orden real de bajada NO se guarda: se deriva de `escaneado_en`.**
  Es el rango del timestamp dentro de la solicitud, y `desvio_orden` es
  `orden_real !== orden_solicitado`.

  Un contador `MAX+1` se rompe de dos formas que en la playa pasan todos los
  días: **dos inspectores** bajando la misma solicitud calculan el mismo máximo,
  y un **escaneo hecho sin señal** a las 10:05 que sincroniza a las 14:00 se
  lleva el número que le corresponde a otro. El timestamp es el mismo hecho y no
  colisiona.

  El costo, que conviene tener escrito: dos teléfonos con el reloj corrido se
  ordenan mal entre sí. Es el orden de una jornada de playa, no un acta; para
  desempatar está `sincronizado_en`.

- **⚠ `escaneado_en` la manda el dispositivo y el servidor NO la recalcula**,
  por lo mismo que `turno_clave` en YI-011: la unidad se bajó cuando se bajó, no
  cuando llegó el POST.

- **⚠ Sin escanear no se carga, sin excepción.** La lista de VINs de la solicitud
  sí se ve —el inspector necesita saber qué viene— pero abrir una unidad para
  cargarla está gateado. Es lo único que obliga a que el registro se haga al lado
  del auto; cualquier escape lo reabre y volvemos al orden anotado de memoria.

  Costo asumido: **una etiqueta ilegible frena esa unidad** hasta que alguien la
  resuelva.

  **Lo que el escaneo no prueba es la presencia**: se puede fotografiar la
  etiqueta. Lo que encarece mentir es la foto obligatoria por daño. Si aun así
  aparece el problema, el escalón siguiente es NFC.

- **El código es Code 128 / Code 39 / Data Matrix, no QR.** Es la etiqueta que el
  auto ya trae; no hay que imprimir ni pegar nada. `js/escaner.js` recibe los
  formatos como parámetro y `Escaner.soportaFormatos()` avisa si el teléfono no
  los lee — que se sepa, no que falle raro.

- **El VIN se extrae con `/[A-HJ-NPR-Z0-9]{17}/`** sobre el texto leído, probando
  todas las ventanas de 17: la etiqueta puede traer los asteriscos de Code 39 o
  el número de motor pegado. Sin I, O ni Q, que el estándar no usa.

- **Endpoints:**

  | Método | Ruta | Qué hace |
  |---|---|---|
  | GET | `api/precarga/catalogos` | `{partes[], tipos_dano[]}`, con ETag como `api/catalogos`. Cada fila lleva `usos` |
  | GET | `api/precarga/solicitudes?jornada=<clave>` | `{jornada, solicitudes[]}`, **cada solicitud con todas sus unidades adentro** |
  | POST | `api/precarga/inspecciones` | Alta de la inspección de una unidad, con sus daños. Idempotente por `uuid` |
  | GET | `api/precarga/jornadas?limite=` | Jornadas cerradas, ya agregadas |

- **⚠ Las unidades vienen en el mismo pedido que la solicitud, no en uno aparte.**
  En la playa no hay señal para ir al servidor por cada camión, y el inspector
  abre el detalle justo cuando está parado al lado. Una jornada son ~18 bahías
  por ~8 unidades: entra sobrado en un payload.

- **La foto del daño es obligatoria en el servidor, no solo en el front.** Si la
  exigiera solo la pantalla, alcanzaría un POST a mano para saltearla.

- **No hay foto panorámica de la unidad.** AppSheet la tenía como campo opcional
  y se sacó: nadie la completaba, y en el teléfono era una caja vacía de 150 px
  entre el resultado y los daños. La única foto que el formulario pide es la del
  daño, y esa sí es obligatoria. Si alguna vez hace falta, vuelve como una
  columna en `precarga_inspeccion` y un paso más en el formulario.

- **La hoja de la unidad se arma en el cliente, no la pide al servidor.** Es el
  `LOGISTIC'S CHECKLIST` del formulario, con los datos que ya vinieron en
  `api/precarga/solicitudes`. No hace falta un endpoint: pedirlo obligaría a
  tener señal justo cuando el inspector cierra la unidad.

  Mantiene el diseño del formulario impreso, incluida la grilla de partes en
  tres columnas y las leyendas del pie: en destino se marca a mano sobre esa
  grilla, así que sacarla dejaría al receptor sin dónde anotar.

  ⚠ **Queda abierto si en destino hay que firmar sobre el papel.** Los recuadros
  de firma se usan para las fotos del daño y solo aparecen cuando la unidad no
  tiene ninguna. Si hacen falta siempre, vuelven y las fotos bajan.

- **⚠ La unidad se cierra con una afirmación, no por omisión.**
 El formulario
  pide «Sin daños» o «Con daños» sin nada preseleccionado, y hasta contestar no
  deja guardar; «Con daños» exige al menos un daño cargado. En el payload eso no
  agrega ningún campo — `danos: []` después de esa elección **es** la
  declaración — pero el servidor debería rechazar una inspección con `danos: []`
  que llegue sin `escaneado_en`, que es la única forma de que aparezca una unidad
  cerrada sin que nadie la haya mirado.

- **`cerrada` en la solicitud.** Una jornada cerrada no acepta inspecciones
  nuevas: el camión ya salió, y sumarle una unidad después sería decir que se vio
  lo que no se vio. Mismo criterio que el botón de agregar observación en
  patrullas, que solo está en los controles de hoy. El front ya no lo ofrece;
  **el servidor tiene que rechazarlo igual**.

- **De dónde salen las solicitudes y las unidades:** de un archivo TXT del
  sistema de solicitudes (la columna `Línea TXT` de AppSheet lo delata). El
  inspector **no las crea**. Conviene una tabla de importación que aísle la
  entrada detrás de un adaptador, como la que tenía el módulo de unidades: el
  contrato del sistema de origen todavía no está definido.

- **El catálogo son 110 partes**, de cruzar dos planillas:
  `Checklist control de precarga y recepcion.xlsx` (hoja UNID1 — la planilla
  Furlong: 95 partes en seis sectores, más los códigos de daño y de gravedad del
  estándar impreso) y
  `Estado de unidades Precarga.xlsx` (hoja Parte — las 70 de AppSheet).

  Cuando las dos nombran la misma pieza **gana el nombre de AppSheet**, que es el
  que los inspectores ya tienen a la vista: pasa en 52 de las 95.

  `precarga_parte.grupo` es el **sector Furlong**, no una categoría inventada.
  Los seis: Frente, Lateral izquierdo, Lateral derecho, Extremo derecho, Tren
  inferior/techo/varios, Interior.

- **Dos cosas del catálogo que decidió la operación, no los documentos:**
  - El sector **"Extremo derecho"** del formulario se llama **"Extremo trasero"**:
    es lo que tiene adentro (luneta trasera, tapa de baúl, faro trasero, rueda de
    auxilio). El nombre impreso queda en el papel; en la app manda el contenido.
  - Los **cajones de sastre se unificaron en uno por sector**, llamado `Otros` en
    los seis. Donde la planilla ya tenía uno se conserva su código Furlong (54,
    55, 98) para poder reconciliar con el papel; Frente, Lateral izquierdo y
    Lateral derecho no tenían y van con id propio (2001–2003). Salieron
    `Informacion especial` (32) y `Compar. motor/otros` (99).

- **⚠ Los 14 tipos de daño NO son los códigos de la planilla.** La planilla trae
  28 códigos numerados (01 doblado, 02 roto exc. vidrio, 19 moldura/burlete…) que
  son el estándar impreso; la operación carga otros catorce, y son estos los que
  van en `precarga_tipo_dano`:

  ```
  Doblado · Roto · Cortado · Abollado · Mellado · Faltante ·
  Contaminado (No daño) · Perforado · Rayado · Vidrio roto ·
  Derrame de fluido · Filo de panel · Desprendido · Fallo de pintura
  ```

  El catálogo tiene que decir lo que la gente elige, no lo que dice el
  formulario. Si alguna vez hay que reconciliar con el papel, los 28 códigos
  están en `Checklist control de precarga y recepcion.xlsx`, hoja UNID1,
  filas 62–73.

- **⚠ El catálogo tiene que mandar `usos` en cada fila.** Es la cantidad de veces
  que esa parte o ese tipo aparecen en el histórico, y **el front ordena las dos
  listas por ahí**: cuatro partes concentran el 55% de los daños y dos tipos
  —Abollado y Rayado— el 77%. En orden de catálogo quedaban cuarto y noveno, o
  sea barrer la lista en tres de cada cuatro cargas. Misma idea que
  `usos_historicos` en `desvio_catalogo` y en `parte`.

  Lo que no figura va en 0 y queda al final, que es lo correcto: son las que casi
  nunca se cargan. `Otros` va último siempre, sin importar sus usos.

- **Pendiente: varios tipos de daño sobre una misma parte.** Hoy cada daño se
  carga entero. Marcar dos tipos de una (abollado + rayado en el mismo golpe)
  sería más rápido, pero la foto es obligatoria por daño: compartir una entre dos
  filas obliga a decidir si el payload la manda dos veces —duplicando cientos de
  KB sobre 3G— o si el contrato aprende a referenciarla desde el nivel de la
  unidad. No se hizo por eso.

- **Las gravedades Furlong están disponibles y no se usan.** La planilla trae los
  8 códigos por tamaño del daño (0 sin excepción, 1 hasta 2,5 cm, …, 5 más de
  30 cm, 6 sustitución/daño severo, 7 faltante). Es el tercer código del estándar
  `AREA - TIPO - GRAVEDAD`; hoy no se registra.

- **Lo que quedó afuera de esta entrega, a decidir:**

  | Qué | Estado |
  |---|---|
  | **Firmas** (inspector y TASA) | No van por ahora. El inspector queda identificado por la sesión de ttfa, más la hora y la foto — más fuerte que una firma dibujada con el dedo. Si auditoría las exige, es un pad en canvas |
  | **Cuadrante** | Queda para después. En AppSheet es un número suelto y obligatorio; sin saber qué significa cada número el dato termina midiendo a quien lo carga. La salida natural es una grilla de 3×3 sobre la parte, con `cantidad_cuadrantes` por parte |
  | **Gravedad** | No se registra, igual que en AppSheet, aunque los 8 códigos ya salieron de la planilla. Es el tercer código del estándar Furlong (`AREA - TIPO - GRAVEDAD`) |
  
---

### YI-014 — Endpoint del tablero de precarga
- **Estado:** pendiente · el front ya está armado y andando contra el mock
- **Prioridad:** media
- **Tipo:** endpoint

- **Qué necesito:** `GET api/precarga/tablero?periodo=anual|mensual`, con todo
  ya agregado.

- **Para qué:** la pantalla de precarga de `/yard/gerencia/`. **No calcula ni una
  métrica en el navegador**, igual que la de patrullas y por el mismo motivo: son
  miles de unidades con su Pareto de partes y cruces por transportista, modelo y
  destino. La API de inspecciones corta en 500 filas y no agrega.

- **Por qué separado de `api/tablero`:** son dos pantallas que se miran en
  momentos distintos. Meter los agregados de precarga en el pedido de patrullas
  haría que abrir una pague el costo de la otra.

- **Forma esperada:**

  ```jsonc
  {
    "meta": { "updated": "2026-08-29", "usuario": { "email": "...", "nombre": "..." } },
    "annual":  { /* los 12 meses */ },
    "monthly": { /* día por día del mes en curso */ }
  }
  ```

  Cada corte:

  ```jsonc
  {
    "stats": {
      "solicitadas": 17318,   // unidades pedidas
      "unidades": 17175,      // bajadas y registradas
      "con_dano": 3178,       // unidades con al menos un daño
      "danos": 4449,          // daños totales (una unidad puede traer varios)
      "desviadas": 1452,      // bajadas fuera del orden solicitado
      "tasa_dano": 18.5, "tasa_desvio": 8.5, "cobertura": 99.2,
      "prev": { "tasa_dano": 19.7, "tasa_desvio": 9.7, "cobertura": 99.0 }
    },
    "serie": [ { "key": "0", "label": "sep",
                 "solicitadas": 1351, "unidades": 1351, "con_dano": 232, "desviadas": 108 } ],
    "pareto_partes": [ { "name": "Puerta trasera izquierda", "grupo": "Exterior",
                         "count": 85, "cumPct": 20.5 } ],
    "pareto_tipos":  [ { "name": "Abollado", "count": 1028, "pct": 23.1 } ],
    "por_grupo":     [ { "name": "Exterior", "count": 4239, "pct": 95 } ],
    "desvios": {
      "por_transportista": [ { "name": "TTFA", "unidades": 3781, "desviadas": 405, "pct": 10.7 } ],
      "por_bahia":         [ { "name": "3A",   "unidades": 2900, "desviadas": 380, "pct": 13.1 } ]
    },
    "por_modelo":  [ { "name": "Hilux", "unidades": 3300, "con_dano": 759, "pct": 23.0 } ],
    "por_destino": [ { "name": "TOYOTA CHILE S.A.", "unidades": 3614, "con_dano": 860, "pct": 23.8 } ]
  }
  ```

- **⚠ Cada `pct` va sobre SU propio denominador**, no sobre el total: las
  unidades que movió ese transportista, las que fueron a ese destino. Sin eso el
  que más mueve encabeza siempre por mover más y no por andar peor — es el mismo
  error que ya se corrigió en la tarjeta de transportistas de patrullas
  (`YI-004`).

- **`cobertura` es métrica de vigilancia, no una salvedad.** Es
  `unidades / solicitadas`: un período por debajo del 100% significa que se
  bajaron unidades sin registrarlas. Baja es mala, al revés que las otras dos.

- **⚠ Si algún día se migran las Inspecciones de AppSheet, esos meses traen la
  misma trampa que el histórico de patrullas.** Allá la inspección se creaba
  **solo cuando había un daño**, así que esos meses tendrían `con_dano` sin
  `unidades` — el denominador no existe. Van con `unidades: null`, ni cero ni
  igual a `con_dano`. Queda escrito antes de que pase.

- **Mientras tanto:** `tools/preview/mock-gerencia.js` define
  `window.TABLERO_PRECARGA` con esta forma y `gerencia/js/datos.js` lo usa si
  está.

---

### YI-015 — Los códigos de daño son un estándar global, no un formulario interno
- **Estado:** **hecho en el front** contra M-22 v4 oficial · falta el backend
- **Prioridad:** alta
- **Tipo:** modelo de datos

- **Qué pasa:** existe una norma global para reportar daño de transporte en
  logística de vehículos terminados — **AIAG M-14 / M-22**, «Global Standard
  Logistics Damage Codes». Define un código de **cinco dígitos** que se arma con
  **área (2) + tipo (2) + gravedad (1)**, y es lo que usan armadoras,
  transportistas y terminales para reclamarse daños entre sí.

- **⚠ La planilla `Checklist control de precarga y recepcion.xlsx` ES ese
  estándar**, traducido al castellano y con las pulgadas pasadas a centímetros.
  Cotejado contra el ejemplo oficial de AIAG:

  | Segmento | Dice AIAG | Dice la planilla |
  |---|---|---|
  | área `10` | Left Front Door | Puerta delantera izq. |
  | tipo `12` | Scratch | Rayado (exc. vidrio) |
  | gravedad `3` | Over 3" up to 6" → 7,6–15,2 cm | Más de 7,5 y hasta 15 cm |

  Los tres coinciden. Los números 1–99 de las partes son los *area codes*, los 28
  códigos de daño son los *type codes*, y las ocho gravedades son la *severity*.

- **Qué rompimos sin darnos cuenta**, tratándolo como papel interno:
  - Los 28 códigos de tipo se reemplazaron por **14 nombres locales** (`YI-013`).
    Son los que la operación carga, así que la decisión no fue mala — pero el
    catálogo perdió el código con el que se habla afuera.
  - **La gravedad no se registra.** Sin ella el código de cinco dígitos no se
    puede armar: quedan tres.
  - Las **16 partes que se sumaron del catálogo de AppSheet** no tienen *area
    code*, así que un daño ahí no es reportable en el estándar.

- **Lo que hay que hacer:** que `precarga_tipo_dano` y `precarga_parte` lleven su
  **código AIAG** además del nombre, y volver a registrar la gravedad. Guardar el
  nombre que la gente elige y el código con el que se reclama no es contradictorio
  — es la misma idea que `desvio_catalogo`, donde el inspector ve un nombre y la
  base guarda un id.

- **Lo bueno: el trabajo está casi hecho.** Los 91 números ya están en el
  catálogo, los 28 códigos de tipo están extraídos de la planilla (hoja UNID1,
  filas 62–73) y las 8 gravedades también. Falta mapear las 16 partes agregadas y
  volver a poner el paso de gravedad en el formulario.

#### El documento apareció, y cambió el resultado

**M-22 no hay que comprarlo:** el [ECG](https://www.ecgassociation.eu/publications-and-reports/aiag-damage-codes/)
—la asociación europea de logística de vehículos, que lo desarrolla junto con
AIAG— publica la versión 4.1 completa y gratis. Está guardado en el scratchpad
como `M-22-v4.1.pdf` y su texto extraído en `M-22-texto.txt`.

Con el documento a la vista, la premisa de la que partimos era **medio falsa**.
La planilla de Furlong es M-22, sí, pero **una revisión distinta y extendida**, y
las diferencias no son cosméticas:

| | Planilla Furlong | M-22 v4 oficial |
|---|---|---|
| `Derrame de fluido` | 33 | **30** |
| Gravedad | 8 códigos (0–7) | **6** (1–6) |
| Corte de gravedad 1 | hasta 2,5 cm | **menos de 3 cm** |
| Corte de gravedad 2 | 2,5 a 7,5 | **3 a 8** |
| Corte de gravedad 3 | 7,5 a 15 | **8 a 15** |
| «Faltante» | gravedad 7 *y* tipo 08 | **gravedad 6**, no hay tipo |
| Área 72–79 | pilares y paneles de cabina | **neumáticos y llantas por esquina** |
| Área 93 | sistema de suspensión | **volante / airbag** |

**El corte de gravedad importa más de lo que parece.** El estándar redondea las
pulgadas a 3 y 8 cm; la planilla las convirtió exacto a 2,5 y 7,6. Un daño de
2,8 cm es gravedad **2** para nosotros y **1** para el estándar — y la gravedad
es lo que fija cuánto se reclama.

**Y lo de 72–79 es lo grave.** Un reclamo con `75043` le dice al otro «llanta
trasera izquierda abollada» cuando quisimos decir «panel de cabina lateral
izquierdo». Todo el punto de usar un estándar es que eso no pase.

#### Cómo quedó

Decidido: **manda el M-22 oficial**. El inspector sigue viendo los nombres de
siempre; lo que cambia es el número que viaja.

- Se cruzaron las 91 partes numeradas contra la lista oficial. **72 coinciden** y
  usan su número. Las otras 19 y las 16 de AppSheet van en `AREA_PROPIA`,
  explícitas y comentadas una por una.
- **84 de 110 partes tienen código oficial** (antes eran 91, con 13 mal).
- Los tipos salieron del documento, no del impreso. Confirmados: `29`
  contaminación exterior, `34` filo de panel. Corregido: derrame `33 → 30`.
- Las 6 gravedades oficiales, con los cortes del estándar.

**Seis partes comparten código con otra**, porque el estándar es más grueso ahí:
las dos ópticas delanteras van a `24`, las traseras a `45`, volante y airbags a
`93`. El nombre local distingue izquierda de derecha; **el código no**.

**26 partes quedan sin código**, y no es un agujero: la planilla extendió el
estándar con piezas de cabina de camión —cuchetas, paneles, largueros— más el
suplemento de paragolpe, el convertidor y la suspensión, que M-22 no contempla.
Se cargan igual y la hoja dice «sin código». Mejor eso que un número que en la
otra punta significa otra cosa.

#### Lo que hay que confirmar con la operación

| Qué | Por qué |
|---|---|
| **Las 26 sin código** | ⚠ Revisar: extender el estándar es normal en el rubro —las plataformas dejan armar catálogos propios—. **Lo que estuvo mal fue pisar los números oficiales, no extender.** Darles un espacio propio que no se confunda con el oficial recupera información que hoy se pierde en `null` |
| **El corner post 71** | El estándar tiene uno solo y se lo lleva el pilar delantero **derecho**, que es arbitrario: el izquierdo queda sin código |
| **`Fallo de pintura` sin código** | Confirmado contra el documento: M-22 codifica daño de **transporte**, y un defecto de pintura sale de planta. Es el 3.º tipo más cargado (347 usos) |
| **`Faltante` y `Desprendido` comparten el 38** | El estándar los junta en «Hardware - Loose, Missing», que es su cajón de sastre. Nosotros los separamos |
| **La regla de los daños múltiples** | El documento dice: varios daños en el mismo panel, sea cual sea su tamaño, se codifican **gravedad 3 o mayor**. No está implementada |
| **⚠ Existe la v6** | Migramos a la **v4**, que es la que el ECG publica gratis. AIAG anunció que la **v6** trae códigos «revised and reassigned» y cambios en las listas de Type y Area: es el mismo error que este ítem vino a corregir, un escalón más arriba. Conseguirla antes de que haya volumen cargado |

#### Lo que falta del backend

- Columna `aiag` en `precarga_parte` y `precarga_tipo_dano` (nullable), y
  `gravedad` TINYINT 1–6 nullable en `precarga_dano`. **Nullable a propósito:**
  el histórico de AppSheet no la tiene, y un daño sin gravedad tiene que seguir
  mostrándose sin código en vez de romper la hoja — ya está probado en el front.
- `POST api/precarga/inspecciones` acepta `gravedad` por daño.
- Migración 009.

---

### YI-016 — Buscar un VIN y ver todo su historial
- **Estado:** pendiente
- **Prioridad:** alta
- **Tipo:** endpoint

- **Qué necesito:** `GET api/precarga/unidades?vin=<parcial o completo>`, que
  devuelva las inspecciones de esa unidad **cruzando jornadas**, cada una con su
  solicitud, sus daños y su orden de bajada.

- **Para qué:** es la pregunta que llega cuando hay un reclamo — «¿qué pasó con
  este auto?». Hoy todo se consulta por jornada (`?jornada=`), así que el
  registro existe pero no se puede interrogar. Es la función que ata a todas las
  demás: sin ella, guardar bien no sirve de nada.

- **Forma esperada:**

  ```jsonc
  { "vin": "8AJ…", "unidades": [
      { "solicitud": { "codigo": "SOL-…", "hora": "…", "equipo": "…", "bahia": "…", "destino": "…" },
        "jornada_clave": "2026-08-29-tarde",
        "orden_solicitado": 3, "orden_real": 2,
        "inspeccion": { "uuid": "…", "escaneado_en": "…", "inspector": {},
                        "danos": [ { "parte_id": 1, "tipo_dano_id": 4, "comentario": null, "foto": "…" } ] } } ] }
  ```

- **La búsqueda va en el servidor, no en el cliente**, por lo mismo que el
  historial de patrullas (`YI-001`): el cliente sólo tiene la jornada en curso, y
  filtrar sobre eso daría una lista corta al lado de un total que es de otra cosa.

- **Parcial y sin acentos.** Un VIN son 17 caracteres y nadie los escribe
  enteros; con los últimos seis alcanza para encontrarlo.

- **Un mismo VIN puede aparecer más de una vez**: el vehículo viaja más de una
  vez. Por eso `unidades` es una lista y no un objeto — lo mismo que dice
  `YI-013` sobre `ix_unidad_vin` no siendo único.

- **Mientras tanto:** el front ya está hecho y andando contra el mock, que
  busca sobre la jornada en curso más las catorce cerradas. Conectar esto es
  implementar el endpoint; la pantalla no cambia.

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

---

### YI-017 — El PDF del legajo por mail, desde el servidor
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** endpoint

- **Qué necesito:** `GET api/precarga/solicitudes/:id/legajo.pdf`, y que el
  servidor pueda mandarlo por mail a las partes.

- **Para qué:** hoy el legajo sale por el diálogo de impresión, que en Android es
  también «Guardar como PDF». Eso alcanza para que el papel viaje con el camión,
  que es lo que pasa de verdad. Lo que **no** puede hacer es que la app agarre el
  archivo: el usuario elige dónde guardarlo y la app nunca lo ve. Mandarlo por
  mail necesita que el PDF exista del lado del servidor.

- **Cómo:** con **[Gotenberg](https://gotenberg.dev/)** —MIT, Docker, envuelve
  Chromium y expone un REST—, que renderiza **el mismo HTML y CSS que ya tiene el
  front**. Es como lo resuelve la categoría ([PAVE](https://pave.ai/),
  [DAMAGE iD](https://www.damageid.com/),
  [Inspectly360](https://www.inspectly360.com/apps/transport-logistics-warehousing/driver-vehicle-inspection-report-app)):
  todas generan el PDF del lado del servidor y lo mandan por mail o WhatsApp.

- **⚠ Lo que NO hay que hacer, y es la parte que importa:** empaquetar un
  generador de PDF en la PWA. jsPDF o pdf-lib son 350 KB a 1 MB en el shell —que
  se instala por 3G— y ninguno renderiza CSS de verdad: o rasteriza la página, o
  hay que **escribir el documento una segunda vez** en primitivas de PDF. Eso
  deja dos implementaciones de la misma hoja, una en CSS y otra en JS, que se van
  despegando en cada cambio. El navegador ya sabe hacer esto bien.

- **Mientras tanto:** el botón dice «Guardar PDF o imprimir» y el archivo sale
  con nombre (`legajo-SOL-90148411-equipo-5566`, `unidad-<VIN>`), porque el
  diálogo usa `document.title` y sin eso los ocho legajos de una jornada salían
  todos como «Yard Inspector.pdf». Funciona sin señal: el CSS de impresión, las
  fotos de la cola y el esquema cacheado están todos del lado del cliente.

---

### YI-018 — La lectura de calidad de la foto
- **Estado:** pendiente
- **Prioridad:** menor
- **Tipo:** campo de datos

- **Qué necesito:** que `precarga_dano` guarde `foto_calidad` —un JSON chico con
  `{ nitidez, luz, aviso }`, nullable— y que el `POST` lo acepte.

- **Para qué:** al sacar la foto la app mide si se ve movida, oscura o quemada, y
  avisa **sin bloquear** (D-019). Si el inspector la usa igual, esa marca tiene
  que viajar con el registro: la hoja impresa la muestra en el pie de la foto,
  para que quien pese la prueba en un reclamo sepa que se avisó. Sin el campo, el
  aviso muere en el teléfono y no sirve de nada.

- **Nullable a propósito:** el histórico de AppSheet no lo tiene, y una foto sin
  lectura tiene que mostrarse sin marca en vez de romper la hoja.
