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

---

## D-018 — Manda el M-22 oficial, no el impreso que tenemos a mano

**Fecha:** 30-08-2026 · **Ambito:** precarga, codigos de daño

D-016 dijo que el impreso de Furlong ES la norma AIAG. Buscando el documento
para completar el punto 3 aparecio que **el ECG lo publica gratis**: la version
4.1 completa, que YI-015 daba por inaccesible porque "M-14/M-22 se compran".

Con el documento al lado, la premisa era **medio falsa**. El impreso es M-22,
pero una **revision distinta y extendida**. Las diferencias medidas:

| | El impreso | M-22 v4 |
|---|---|---|
| Derrame de fluido | 33 | 30 |
| Gravedad | 8 codigos | 6 |
| Corte de gravedad 1 y 2 | 2,5 y 7,5 cm | 3 y 8 cm |
| Areas 72 a 79 | pilares y paneles de cabina | neumaticos y llantas |
| Area 93 | suspension | volante / airbag |

**Decision:** el codigo que se guarda sale del **documento oficial**. El
inspector sigue viendo los nombres del impreso; lo que cambia es el numero que
viaja. Las 91 partes numeradas se cruzaron una por una: 72 coinciden y usan su
numero, las otras 19 van explicitas en `AREA_PROPIA`.

**Motivo:** un codigo existe para que signifique lo mismo en las dos puntas. Un
reclamo con `75043` le dice al otro «llanta trasera izquierda abollada» cuando
quisimos decir «panel de cabina lateral izquierdo». Si el numero no viaja bien,
no estamos usando un estandar: estamos usando una numeracion propia que **parece**
un estandar, que es peor que no tener ninguno --nadie la revisa porque parece
oficial--.

El corte de gravedad es el mismo problema en chico: el estandar redondea las
pulgadas a 3 y 8 cm y el impreso las convirtio exacto a 2,5 y 7,6. Un daño de
2,8 cm es gravedad 2 para nosotros y 1 para ellos, y la gravedad fija cuanto se
reclama.

**Costo, y es real:** **26 de 110 partes quedan sin codigo**. El impreso extendio
el estandar con piezas de cabina de camion --cuchetas, paneles, largueros-- mas
el suplemento de paragolpe, el convertidor y la suspension, que M-22 no tiene. Se
cargan igual y la hoja dice «sin codigo». Y el papel que el inspector tiene
pegado en la playa sigue diciendo los numeros viejos, asi que hay que avisarle a
la gente antes de que empiece a conciliar a mano.

**Lo que NO se hizo, a proposito:** no se les invento un codigo desde la otra
revision. Eso es lo que produjo el problema: numeros que parecen del estandar y
no lo son. Sin codigo se ve; con un codigo equivocado, no.

**Reversibilidad:** media. `AREA_PROPIA` y `AIAG_TIPO` son dos objetos y cambiar
uno es una linea. Lo que no vuelve gratis son los registros ya cargados con la
escala vieja de gravedad: si se revierte, hay que migrarlos.

**Como se descubrio:** preguntando como resuelven esto los que venden el mismo
software, que es D-016 aplicado una segunda vez. La primera encontro que el papel
era una norma; la segunda, que nuestra copia de la norma estaba vencida.

---

## D-019 — La foto avisa, no bloquea, y queda anotado

**Fecha:** 30-08-2026 · **Ambito:** precarga, foto del daño

En precarga **la foto ES la prueba** --lo unico que sostiene un reclamo-- y su
calidad dependia enteramente del pulso del inspector. El rubro chequea esto en el
momento de sacarla: Monk mide desenfoque, exposicion, angulo y partes visibles.

**Decision:** al comprimir se mide **nitidez y luz**, y si la foto se ve movida,
oscura o quemada aparece un aviso debajo. **El aviso no deshabilita nada**: el
boton de agregar el daño sigue vivo y el texto dice «si es la unica que se puede
sacar, va igual». Lo que cambia es que **la lectura viaja con el registro** y la
hoja impresa la muestra en el pie de la foto.

**Por que no bloquea.** Bloquear seria decidir desde un heuristico que el
inspector no puede documentar un daño. Una bahia sin luz o un auto mojado dan
lecturas malas con fotos que son lo unico que hay, y el que esta parado al lado
del auto sabe mas que el algoritmo. Es lo contrario del gate del escaneo (D-015),
y la diferencia es cual es el costo del error: sin escanear no hay registro
valido, pero una foto imperfecta sigue siendo mejor que ninguna.

**Por que igual se anota.** Un aviso que se puede ignorar y no deja rastro no
existe. Con la marca en el registro, quien pese la prueba despues ve que se
aviso y se uso igual -- que es informacion real sobre la prueba, no un reproche
al inspector.

**El riesgo era la friccion, y estaba medido de antemano.** En las reseñas de la
categoria la queja mas repetida es «sacar fotos deberia ser rapido, sin tantos
requisitos sin sentido». Por eso: un solo aviso, sin pasos nuevos, sin
confirmacion. Y **no se implemento la secuencia de angulos con plantilla**: eso
es un walkaround del vehiculo y nuestras fotos son por daño -- no hay un juego
de angulos fijos para «un rayon en la puerta delantera izquierda».

**La nitidez sale del percentil 99 del laplaciano, no de su varianza.** La
varianza es la receta de manual y aca daria falsos rechazos todo el dia: el
inspector fotografia **paneles pintados y planos**, legitimamente de baja
varianza aunque esten enfocados. Medido con un panel liso y un solo rayon fino:

| Foto | Nitidez (p99) | Resultado |
|---|---|---|
| Panel plano, **nitido** | 43 | pasa |
| Panel plano, movido 7 px | 8 | avisa |
| Panel plano, movido 16 px | 3 | avisa |
| Escena con textura, nitida | 151 | pasa |

El corte esta en 18, comodo entre 43 y 8. Los umbrales estan elegidos **para que
el falso rechazo sea raro**, no para atajar todo: si el aviso molesta cuando no
corresponde, el inspector deja de mirarlo y el paso entero se vuelve decorativo.

**Costo: 2 ms.** Se mide sobre el canvas que la compresion ya dibujo, sobre una
copia de 360 px. La compresion de una foto de 3000x4000 son 1.124 ms y ya
estaban.

**Reversibilidad:** total. Son tres constantes.

---

## D-020 — El esquema marca la zona, y ahi se queda

**Fecha:** 30-08-2026 · **Ambito:** precarga, esquema del vehiculo

Estaba planificado darle **coordenadas por parte** al esquema, para marcar el
punto exacto en vez del sector: ~110 coordenadas sobre cinco vistas y ocho
modelos con proporciones distintas.

Mirando como lo resuelve el rubro aparecio que **hay dos escuelas**: las
plataformas de terminal usan diagramas por panel, y las de transporte terrestre
--Super Dispatch-- **marcan el daño sobre la foto**, que ya es obligatoria.

**Decision:** ninguna de las dos. **El esquema se queda marcando la zona**, como
esta.

**Motivo:** el esquema no es el registro. El dato son los daños de la lista, con
su parte exacta, su codigo AIAG y su foto; el dibujo es la ayuda para ver de un
golpe que no se salteo un lado del auto, que es la misma lectura que hoy se hace
mirando el circulo en el papel. **Para eso la zona alcanza.** El punto exacto
agregaria precision a la ayuda, no al registro -- y la precision del registro ya
la da el nombre de la parte, que es mas exacto que un punto en una silueta
generica de un modelo que no es el auto que se esta mirando.

**Costo:** un mapeo largo y facil de errar que no se hace. Si algun dia se
quiere, las coordenadas entran sin tocar la pantalla, que es como estaba pensado.

**Reversibilidad:** total, no se saco nada.

---

## D-021 — El acento es el azul de la intranet, no el rojo de Toyota

**Fecha:** 30-08-2026 · **Ambito:** los tres modulos, `tokens.css` y `app.css`

Esta app arranco con `--ttfa-red: #EB0A1E` de **acento primario**, por venir del
design system de marca. Mirando capturas de **TTFA Intranet**, que es donde esto
vive, la definicion real es otra:

| En la intranet | Color |
|---|---|
| Acciones: «Cargar hs», «+ Nuevo PR», «Solo extras» | **azul** |
| Filtros y pestañas activas | **azul** |
| Navegacion activa | pastilla neutra clara |
| Aprobado | verde |
| Pendiente | ambar |
| **Rechazado, e icono de borrar** | **rojo, y nada mas** |

**El problema no era estetico.** Con el rojo de acento, un chip de filtro
seleccionado --«Todos», «Batea»-- se pintaba **igual que un chip NG**. El mismo
color decia «esto esta seleccionado» y «esto esta mal», y cuando el acento de
marca y el de alerta son el mismo, **el rojo deja de significar peligro**. En una
app cuyo trabajo es marcar lo que esta mal, eso es perder la herramienta
principal.

**Decision:** entra `--accento` (#2563EB oscuro, #1D4ED8 claro) para **accion,
seleccion, foco y marca de UI**. El rojo se queda **solo** para lo que esta mal:
NG, novedades, alertas, rechazos, el error del escaner.

Repartido: 16 lineas de CSS pasaron a azul, 36 quedaron rojas. Verificado
recorriendo las ocho pantallas de los tres modulos y midiendo el color
computado, no leyendo el CSS.

**Se toco tambien patrullas, y no es desprolijidad.** `.tag.sel`, `.btn` y
`.tab.activo` son componentes compartidos por los tres modulos. Hacerlo «solo en
bahias y precarga» obligaba a bifurcarlos, y dejaba una app donde el mismo chip
es rojo en una pantalla y azul en la otra -- peor que cualquiera de las dos
opciones enteras.

**De paso, los badges pasan al molde de la intranet:** pastilla redonda
(`999px`), sin aro de color, en minuscula y peso medio. Antes eran versalitas
con borde solido, que es mas duro que todo lo que hay alrededor.

**Reversibilidad:** total. Son seis tokens y las 16 lineas estan listadas en el
script; volver es cambiar `--accento` por `--ttfa-red`.

**⚠ Lo que no pude verificar:** la app de TTFA vive en la intranet detras del
`auth_request` y no se alcanza desde el entorno de desarrollo. La paleta salio de
**cuatro capturas** --Inicio, PRs, Fichadas y Cargas-- asi que los hex son los
que se leen ahi (#2563EB y la familia verde/ambar/rojo estandar). Si la intranet
tiene tokens propios, conviene copiarlos y no aproximarlos.

---

## D-022 — Las fuentes que pediamos afuera nunca llegaban

**Fecha:** 30-08-2026 · **Ambito:** `index.html`, `gerencia/index.html`, `tokens.css`

`index.html` pedia **Archivo e IBM Plex Mono a Google Fonts**, con un comentario
que decia que si no llegaban la app usaba la de respaldo. El comentario asumia
que el caso malo era «sin señal».

**El caso malo es siempre.** La linea 159 de `CLAUDE.md` ya lo tenia escrito para
otra cosa: los iconos van inline y no contra el CDN de Lucide porque **«un pedido
a un dominio de afuera no pasa la politica de la intranet»**. La misma regla
aplica a las fuentes, y nadie la habia cruzado: en TTFA esas dos familias no
cargan **nunca**, y la app renderiza siempre con la pila de respaldo.

O sea que **lo que se veia en desarrollo no era lo que se veia en produccion**, y
todo el trabajo de tipografia se estaba haciendo contra una fuente que el
inspector no ve. El tablero de gerencia tenia el mismo pedido.

**Decision:** se deja de pedir lo que no puede llegar. La pila pasa a ser la del
sistema --Roboto en el Android del inspector, Segoe UI en el escritorio de
gerencia-- que ademas es lo que se ve en la intranet.

**Lo que se pierde:** el caracter propio de Archivo. Se acepta: una fuente que no
carga no tiene caracter, y esta app vive **adentro** de otra, donde parecerse es
mejor que distinguirse.

**Lo que NO se hizo:** empaquetar las woff2 en el repo. Son ~175 KB entre las
siete variantes, en un shell que se instala por 3G, para una diferencia
tipografica que nadie pidio. Si algun dia se quiere, entran cache-first como los
esquemas de vehiculo (D-013) y no en el `SHELL`.

**Verificado corriendo:** `performance.getEntriesByType('resource')` filtrado por
origen distinto devuelve **cero** en las tres pantallas.

**De paso, dos cosas del mismo molde:**

- **Las esquinas se redondearon**: 2/4/8 px pasan a **4/8/12**, y el boton
  primario a pastilla, como el «Cargar hs» de la intranet. Con las anteriores la
  app se veia mas dura que todo lo que la rodea.
- **Los iconos tenian diez tamaños** --12, 13, 14, 15, 16, 17, 18, 20, 30, 34--
  que no es una escala sino lo que fue quedando. Quedan cinco: 12 adentro de un
  chip, 14 en linea con el texto, 16 en filas y botones chicos, 18 en el primario,
  20+ en los estados vacios.
- **Las tarjetas KPI** llevan borde y esquina propia, y **el estado va en el
  borde** ademas del numero -- como las de Inicio, donde la que necesita atencion
  se reconoce de reojo sin leer la cifra.
