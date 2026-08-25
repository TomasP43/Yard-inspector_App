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
