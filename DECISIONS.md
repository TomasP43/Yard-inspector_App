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
crea el volumen**. Con la base ya existente, las migraciones 005 en adelante
nunca se hubieran aplicado y el código habría buscado tablas inexistentes. Con
deploy automático en cada push, eso se rompe en silencio.

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

## D-003 · El código de gravedad del estándar Furlong

**Pregunta:** ¿se registra el tamaño del daño?

**Evidencia:** el check list en papel codifica `ÁREA - DAÑO - GRAVEDAD`
(ej. `37-04-03`). Pero **ese proceso ya no está vigente**: lo confirmó el
usuario. El estándar en uso es el de localización de daños 2024, que define los
cuadrantes y no pide tamaño.

**Decisión:** no se registra. Llegó a entrar en la 005 y lo saca la 007.

**Motivo:** modelar un proceso muerto agrega un campo obligatorio que nadie
completa.

**Reversibilidad:** media. Volver a agregarlo es una migración; recuperar el
dato histórico que no se cargó, imposible.

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
