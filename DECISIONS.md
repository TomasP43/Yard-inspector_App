# Registro de decisiones

Por qué el proyecto es como es. Cada entrada tiene que poder responder
"¿por qué hicimos esto?" dentro de seis meses, sin releer el código.

Formato: **pregunta**, opciones consideradas, evidencia, decisión, motivo y
qué tan reversible es.

---

## D-001 · Cómo se aplican las migraciones

**Pregunta:** ¿`/docker-entrypoint-initdb.d` o un runner en el backend?

**Opciones:** (a) el montaje de MySQL, (b) el backend al arrancar, (c) las dos.

**Evidencia:** `docker-entrypoint-initdb.d` corre **solo la primera vez que se
crea el volumen**. Con la base ya existente, toda migración posterior a la
primera nunca se hubiera aplicado y el código habría buscado tablas
inexistentes. Con deploy automático en cada push, eso se rompe en silencio.

**Decisión:** (b), el backend al arrancar, con registro en `migracion_aplicada`.
Se quitó el montaje de initdb.

**Motivo:** un solo mecanismo. Dos caminos que hacen lo mismo divergen.

**Reversibilidad:** alta, pero volver atrás reintroduce el problema.

---

## D-002 · Qué pasa si una migración falla

**Pregunta:** ¿el backend arranca igual o se cae?

**Decisión:** se cae. `migrar()` corre antes de `app.listen()`.

**Motivo:** arrancar sobre una base a medio migrar produce fallas sutiles y
tardías. Caerse produce una falla ruidosa e inmediata.

**Costo real, ya pagado:** un bug de ruta en el runner tiró el backend entero y
dio 502 en todo, incluido `/health`. Es exactamente el comportamiento buscado —
el error fue del runner, no de la política.

**Reversibilidad:** alta.

---

## D-004 · Fusión de catálogos por parecido

**Pregunta:** cuando alguien escribe un desvío parecido a uno existente,
¿se fusiona solo?

**Evidencia:** en AppSheet había 78 grafías para 71 conceptos. Pero
`Matafuego vencido` y `Matafuego descargado` comparten casi todo y son cosas
distintas.

**Decisión:** **nunca** se fusiona por parecido. Solo por coincidencia exacta ya
normalizada, que resuelve la colación de la base. El parecido se **sugiere** y
decide una persona; si crea igual, queda con `revisar=1`.

**Motivo:** un duplicado visible se arregla después. Un concepto absorbido
dentro de otro no se recupera nunca.

**Reversibilidad:** total.

---

## D-005 · Verificación: ejecutar antes que revisar

**Pregunta:** ¿cómo se sabe que algo funciona?

**Evidencia, dura:** 77 chequeos estáticos del módulo de unidades pasaron todos,
y el backend desplegado no arrancaba. Después la API devolvía los catálogos
perfectos y la app estaba muerta igual, por un `.map()` sin guarda. Ninguno de
los dos era visible leyendo el código.

**Decisión:** nada se da por funcionando sin ejecutarlo. Orden de preferencia:
correr el código, tests, compilador y schema, HTTP real contra el deploy, y solo
al final juicio humano o de modelo, reservado para lo no ejecutable.

**Motivo:** la verificación vale lo que vale su señal independiente. Los
chequeos estáticos sirven para consistencia, no como prueba de funcionamiento.

**Reversibilidad:** no aplica. Es política de trabajo.

---

## D-006 · Idempotencia de la cola offline

**Pregunta:** ¿qué devuelve el servidor si llega dos veces la misma inspección?

**Decisión:** 200 con el registro existente y `duplicada: true`. Nunca 409.

**Motivo:** con un 409 el cliente no sabe si puede sacarlo de la cola. Con 200
sí. Una inspección solo sale de la cola cuando el servidor confirma que la
guardó.

**Reversibilidad:** alta, pero cambiarlo obliga a tocar el cliente a la vez.

---

## D-009 · El repo se queda solo con patrullas

**Pregunta:** ¿el módulo de inspección de unidades convive con el de patrullas
en este repo?

**Decisión:** no. El repo hace **una sola cosa**: observaciones de equipos.
Se borraron el módulo de unidades entero, sus migraciones 005–008 y el menú de
entrada que existía solo para elegir entre los dos.

**Consecuencias que hay que tener presentes:**

- La app vuelve a la raíz: `/yard/`, no `/yard/patrullas/`. Un solo service
  worker, con scope sobre toda la app. Las URLs viejas redirigen.
- Las tablas de unidades **siguen en la base desplegada**. No se dropean desde
  una migración: es irreversible y no hay apuro. El SQL para tirarlas está en
  el historial de git si alguna vez se quiere.
- **La próxima migración es la 009.** Ver la nota en `CLAUDE.md`.

**Motivo:** un menú de una sola opción es fricción pura — el inspector abre la
app y tiene que tocar una vez más para llegar a lo único que hay.

**Reversibilidad:** total mientras el historial de git exista. El módulo entero
está en el commit anterior a este.

> **Ya no describe el repo, y conviene decirlo acá y no dejar que envejezca en
> silencio.** Después entraron **control de bahías** y **inspección de
> precarga**, así que hoy son tres módulos. Lo que sobrevive de esta decisión no
> es "un solo módulo" sino **cómo conviven**: comparten página, service worker y
> cola de sincronización, y el cajón lateral cambia de módulo en vez de un menú
> de entrada. El menú de una sola opción era la fricción que se quiso sacar; un
> cajón que ya está ahí para el tema y la sesión no cuesta un toque de más.
>
> Lo que **sigue vigente tal cual**: las tablas de unidades siguen en la base
> desplegada sin dropear, y **los números 005–008 siguen quemados**. La próxima
> migración es la 009.

---

## D-010 · Cómo se porta el design system de Claude Design

**Pregunta:** el diseño (`Yard Inspector.dc.html`, design system TTFA) es React
sobre un runtime de canvas, con tokens importados y los iconos como máscara CSS
contra el CDN de Lucide. ¿Se porta tal cual?

**Decisión:** se porta el **resultado visual**, no el mecanismo. Tres cosas
cambian a propósito:

| Del diseño | En la app | Por qué |
|---|---|---|
| Iconos desde `unpkg/lucide-static` | `js/iconos.js`, inline | Sin conexión no llegan, y un pedido a otro dominio no pasa la política de la intranet |
| `@import` de los tokens | copiados en `css/app.css` | Mismo motivo |
| Solo oscuro | además modo claro | Esto se usa al sol; una pantalla oscura ahí se lee mucho peor. El botón va en el menú lateral, para no ensuciar la barra que el diseño limpió |

También se **agregó** lo que el diseño no muestra pero la operación usa
(`controlador`, `estado_control`): plegado en "Más datos del control". Un
formulario que deja de guardar un campo pierde el dato en silencio.

Y se **quitaron** las flechas de tendencia de los KPI. El componente `KpiStat`
las dibuja para cualquier `delta`, pero acá el pie es una descripción, no una
variación: una flecha para arriba al lado de "42 % de los controles" afirma una
tendencia que nadie calculó.

**Reversibilidad:** alta. El proyecto de diseño sigue siendo la fuente; esto es
una implementación de él.

---

## D-011 · Los desvíos se agrupan por zona del equipo

**Pregunta:** el catálogo son ~70 nombres en una lista plana. ¿Se deja así?

**Evidencia:** elegir el desvío era el paso más lento de la carga — de pie, con
guantes, buscando "Matafuego vencido" en una lista de 70. El diseño lo parte en
7 zonas del equipo: dos toques en vez de un scroll.

**Decisión:** agrupado, pero **en el cliente** (`js/zonas.js`), no en la base.
Es presentación, no un dato de la inspección: lo que se guarda sigue siendo el
id del desvío.

**El catálogo manda, no la lista.** Los nombres se cruzan contra `CAT.desvios`;
lo que la base tenga y no esté mapeado cae en "Otros". Sin esa regla, un desvío
que agrega un inspector desde la app dejaría de ser elegible hasta que alguien
tocara el código — que es exactamente el problema que el catálogo extensible
vino a resolver.

**Reversibilidad:** total. Si algún día se administra desde un panel, pasa a ser
una columna `zona` en `desvio_catalogo` y el archivo se cae.

---

## D-012 · El NG anterior se resuelve antes de cargar el nuevo

**Pregunta:** si el último control de un equipo fue NG, ¿el control siguiente
arranca en blanco?

**Evidencia:** en AppSheet sí, y por eso no había forma de saber si un desvío se
corrigió o se viene arrastrando. El dato existía —el histórico muestra equipos
con el mismo desvío cinco veces— pero nadie lo cerraba.

**Decisión:** antes que nada, el formulario pregunta qué pasó con cada desvío
abierto: corrigió o reincidió. Reincidió lo vuelve a marcar solo y salta a su
zona. **El botón de guardar queda bloqueado hasta contestar.**

**Motivo:** un paso que se puede saltear se saltea. Si se pudiera, el NG viejo
quedaría colgado para siempre, que es justo lo que este paso vino a evitar.

**Reversibilidad:** alta, es solo cliente. Pero ojo: hoy la resolución **no se
persiste** como tal — se refleja en si el desvío vuelve a aparecer o no en el
control nuevo. Guardarla explícitamente necesita una tabla y es la 009.

---

## D-013 · IndexedDB y el service worker son mejoras, no requisitos para abrir

**Pregunta:** ¿qué pasa si el navegador no da almacenamiento local?

**Evidencia, encontrada corriendo la app:** tres cuelgues distintos, todos con la
misma forma — una promesa que **no se resuelve nunca**, que ningún `try/catch`
atrapa porque no rechaza:

| Dónde | Qué pasaba |
|---|---|
| `navigator.serviceWorker.ready` en `encolar()` | El control quedaba guardado en la cola pero **no se mandaba**, no aparecía el aviso y el botón se quedaba en "Guardando…" para siempre |
| `indexedDB.open()` en la primera línea de `cargarCatalogos()` | La app **no arrancaba**: sin catálogos, sin pantallas pintadas, sin ningún mensaje |
| `DB.leerCola()` dentro de `sincronizar()` | El estado quedaba en "Sincronizando…" para siempre |

Los tres pasan de verdad: modo privado en iOS, cuota agotada, un
`deleteDatabase` trabado, `sw.js` con un error, http sin contexto seguro.

**Decisión:** nada que sea una mejora puede estar en el camino crítico.

- `indexedDB.open` tiene **tope de 3 segundos** y recuerda el fallo, para no
  pagar la espera en cada guardado.
- El registro de Background Sync va **sin `await`**.
- Escribir el cache **nunca** corta el pintado: se pinta primero y se guarda
  después.
- Si no hay base pero hay señal, el control **se manda directo**. Se pierde
  poder cargar sin conexión, no poder trabajar.
- Y se **avisa**: pill "Sin memoria local" con el detalle en el title.

**Motivo:** el inspector tiene que poder cargar. Que el navegador no le preste
memoria es un problema del navegador, no una razón para que la app se rinda —
y sobre todo, no una razón para que se rinda **en silencio**.

**Reversibilidad:** alta. Son topes y guardas, no cambios de arquitectura.

**Cómo se encontró:** ejecutando el flujo de carga en el navegador, no leyendo
el código. Los tres eran invisibles en revisión: no hay error, no hay excepción,
no hay nada en consola. Ver D-005.

---

## D-014 · De dónde sale el orden real de bajada

**Pregunta:** cuando el inspector baja una unidad, ¿cómo se le asigna el número
de orden real, el que se compara contra el solicitado?

**Opciones:** (a) un contador `MAX(orden_real)+1` sobre la solicitud, que es lo
que hacía AppSheet; (b) que el inspector lo escriba; (c) derivarlo del momento
del escaneo.

**Evidencia:** el contador se rompe de dos formas que en la playa pasan todos los
días. **Dos inspectores** bajando la misma solicitud calculan el mismo máximo y
los dos se quedan con el 3. Y un **escaneo hecho sin señal** a las 10:05 que
sincroniza a las 14:00 se lleva el número que ya tomó otro. Escribirlo a mano
mueve el problema a la persona y encima es más lento con guantes.

**Decisión:** (c). El dispositivo manda `escaneado_en` y el orden real es el
**rango de ese timestamp dentro de la solicitud**. `desvio_orden` es
`orden_real !== orden_solicitado`, derivado, no guardado.

**Motivo:** el timestamp es el mismo hecho —cuándo se bajó— expresado de una
forma que no colisiona. Y es la misma regla que `turno_clave` en bahías: el
dispositivo manda el hecho, el servidor deriva. Deducirlo de la hora de llegada
del POST sería deducir la playa desde la oficina.

**Costo asumido:** dos teléfonos con el reloj corrido se ordenan mal entre sí.
Es el orden de una jornada de playa, no un acta; si algún día importa, está
`sincronizado_en` para desempatar.

**Reversibilidad:** alta mientras `escaneado_en` se siga guardando. Volver a un
contador obliga a tocar cliente y servidor a la vez.

---

## D-015 · El VIN se escanea, y sin eso no se carga

**Pregunta:** ¿la unidad se elige de la lista o hay que escanearla?

**Opciones:** (a) de la lista, como AppSheet; (b) escaneo obligatorio; (c)
escaneo con un escape registrado.

**Evidencia:** es el mismo problema del papel de las bahías. El dato se puede
llenar en la oficina, y entonces el orden real de bajada es lo que alguien
recuerda, no lo que pasó. **Un escape que se puede tomar se toma**: si la lista
queda disponible "para cuando la etiqueta esté rota", pasa a ser el camino
normal y el escaneo se vuelve decorativo.

**Decisión:** (b), sin excepción. La lista de VINs **sí se ve** —el inspector
necesita saber qué viene— pero abrir una unidad para cargarla está gateado.

Se escanea **la etiqueta de VIN que el auto trae de fábrica** (Code 128 /
Code 39 / Data Matrix), no un sticker propio: no hay que imprimir ni pegar nada
por unidad, y la etiqueta ya está donde tiene que estar.

**Motivo:** es lo único que obliga a que el registro se haga al lado del auto,
que es todo el punto del módulo.

**Costo asumido, sabido de antemano:** una etiqueta ilegible **frena esa unidad**
hasta que alguien la resuelva. Es la misma apuesta que el sticker mojado de una
bahía, y se toma por la misma razón.

**Lo que el escaneo no prueba es la presencia**, y conviene tenerlo escrito: se
puede fotografiar la etiqueta. Lo que encarece mentir es la foto obligatoria por
daño. Si aun así aparece el problema, el escalón siguiente es NFC.

**Reversibilidad:** alta, es una guarda de cliente. Pero abrirla la vuelve
inútil: no hay medio gate.

---

## D-016 · Mirar el mercado antes de dar por cerrado un modulo

**Pregunta:** el modulo de precarga ya estaba andando. ¿Que aporta comparar con
productos que resuelven lo mismo?

**Evidencia, dura:** el benchmark encontro en una tarde que
`Checklist control de precarga y recepcion.xlsx` **no es un formulario de la
casa: es el estandar AIAG M-14 / M-22**, la norma global para reportar daño de
transporte en logistica de vehiculos terminados. Cotejado contra el ejemplo
oficial, area 10, tipo 12 y gravedad 3 coinciden exactamente con la planilla.

Sobre esa premisa equivocada se habian tomado tres decisiones:

| Se decidio | Con el estandar a la vista |
|---|---|
| Reemplazar los 28 codigos de tipo por 14 nombres | Los 28 son los *type codes* con los que se reclama afuera |
| No registrar la gravedad | Es el quinto digito; sin ella el codigo no se arma |
| Sumar 16 partes sin numero | Sin *area code* no son reportables |

Ninguna de las tres se veia mal desde adentro. Las tres se ven distinto sabiendo
que el papel es una norma.

**Decision:** antes de dar por cerrado un modulo, mirar que hacen los productos
que resuelven lo mismo. No para copiarlos --el orden de bajada, que la operacion
pidio primero, no lo cubre ninguno-- sino para **descubrir el vocabulario del
dominio**, que es donde estan los errores que no se ven desde el codigo.

**Motivo:** los formularios que una operacion usa hace años rara vez se
inventaron ahi. Tratar uno como interno cuando es una norma se paga tarde, en el
primer reclamo que hay que traducir a mano.

**Costo:** una tarde de busqueda. Barato contra rehacer el modelo de datos
despues de cargar meses de daños.

**Reversibilidad:** no aplica. Es politica de trabajo, como D-005.

---

## D-017 — El codigo AIAG se deriva, no se pide

**Fecha:** 30-08-2026 · **Ambito:** precarga, formulario de daño

Con el hallazgo de D-016 --el impreso de Furlong es la norma AIAG M-14/M-22--
habia que meter el codigo de cinco digitos en el modulo. La forma obvia era un
campo donde el inspector lo escribe, que es lo que hacia AppSheet.

**Decision:** el codigo **no se pide nunca**. Se arma solo: el area son los dos
primeros digitos y sale del **numero de la parte que el inspector ya eligio**, el
tipo son los dos siguientes y sale del **daño que ya eligio**, y lo unico que se
agrego es un paso de **tamaño** --un toque, siete opciones, nada
preseleccionado--. `Paragolpe delantero` + `Abollado` + `7,5-15 cm` es `03043`,
sin que nadie escriba un numero.

**Motivo:** alguien que ya dijo «paragolpe delantero, abollado, de unos diez
centimetros» dijo el codigo entero. Pedirselo de nuevo en cifras es pedir lo
mismo dos veces, y es el molde exacto del campo que se saco en YI-008: uno que
mide al que lo carga en vez de medir lo que se encontro. Un codigo tipeado a mano
tiene ademas la falla de que **un digito mal no se ve**: `03043` y `03042` son
los dos plausibles, y nadie los revisa.

**Costo:** un paso mas por daño, obligatorio. Se acepta porque el tamaño es el
unico de los tres que el inspector todavia no habia dicho, y porque sin el no hay
codigo: quedan cuatro digitos de cinco.

**Lo que el codigo NO inventa.** Cuando falta alguna de las tres piezas no se
muestra un codigo a medias: se muestra **por que no hay**. Pasa en tres casos
reales --19 partes sin numero de area, `Fallo de pintura` que la norma no tiene
porque es defecto de planta y no de transporte, y los daños viejos cargados antes
de que existiera el paso--. Un `03000` de relleno viajaria a un reclamo como si
significara algo.

**Reversibilidad:** alta en el front. La que no es reversible es la de los
codigos elegidos sin poder consultar (`29` para contaminado, `33` para derrame,
`38` para desprendido): esos ya viajan en los registros, y cambiarlos despues
obliga a migrar lo cargado. Estan marcados en YI-015 para que los confirme la
operacion antes de que haya volumen.
