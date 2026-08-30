'use strict';

/**
 * Datos falsos para mirar el front sin base ni backend.
 *
 * Intercepta `fetch` y responde con **la forma exacta que devuelve la API
 * real**. Si la API cambia de forma, esto tiene que cambiar con ella o el
 * preview empieza a mentir — que es peor que no tenerlo.
 *
 * Se genera todo aca en vez de traer un volcado: un archivo de datos se
 * desactualiza y ademas mete cientos de KB al repo para nada. Con semilla fija,
 * asi dos corridas muestran lo mismo y una diferencia visual es un cambio real.
 *
 * NO se despliega. Solo lo carga tools/preview/armar.sh dentro de .preview/.
 */
(() => {
  // Congruencial lineal: cualquier PRNG sirve, lo que importa es que sea
  // reproducible entre corridas.
  let semilla = 20260825;
  const rnd = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const uno = (a) => a[Math.floor(rnd() * a.length)];

  const TRAFICOS = ['Brasil', 'Autoport', 'Chile', 'Paraguay', 'Bolivia', 'CAT', 'Uruguay', 'Green Mile'];
  const DEMORAS = ['Cargo', 'Se retira', 'Demora en carga'];
  const OBSERVACIONES = [
    'Se detectó en bahía 4, al costado del acceso. Se avisó al transportista.',
    'Ya se le había marcado la semana pasada y no se corrigió.',
    'El equipo entró directo a carga, se controló sobre la marcha.',
    'Reincidente. Va tercera vez este mes con lo mismo.',
    'Se pidió control en TASA antes de despachar.'
  ];
  // Nombres inventados a proposito. El preview se publica en una web abierta
  // y no corresponde poner nombres de gente real al lado de sus metricas.
  const AUDITORES = [
    { id: 1, nombre: 'Inspector Uno', email: 'inspector1@ejemplo.com' },
    { id: 2, nombre: 'Inspector Dos', email: 'inspector2@ejemplo.com' }
  ];

  // El catalogo sale de las zonas, que es el mismo mapa que usa la app.
  const desvios = [];
  Zonas.MAPA.forEach((z) => z.items.forEach((nombre) => {
    desvios.push({ id: desvios.length + 1, nombre, tipo_desvio_id: null, requiere_detalle: false, activo: true, usos_historicos: 0 });
  }));
  // Uno que no esta en ninguna zona, para ver que "Otros" aparece.
  desvios.push({ id: desvios.length + 1, nombre: 'Faltante sin clasificar', activo: true, revisar: true, usos_historicos: 0 });

  const demoras = DEMORAS.map((n, i) => ({ id: i + 1, nombre: n }));
  const responsables = TRAFICOS.map((n, i) => ({ id: i + 1, nombre: 'Trafico ' + n }));
  const equipos = Array.from({ length: 60 }, () => entre(120, 7999)).sort((a, b) => a - b);

  const CATALOGOS = {
    usuario: { email: 'demo@ejemplo.com', nombre: 'Usuario Demo' },
    responsables,
    desvios,
    demoras,
    controladores: ['Control A', 'Control B', 'Control C'].map((n, i) => ({ id: i + 1, nombre: n })),
    estados_control: ['Controlado', 'Solicitado controlar en TASA'].map((n, i) => ({ id: i + 1, nombre: n })),
    equipos: [...new Set(equipos)]
  };

  // 14 jornadas, con un par de dias sin actividad para que el grafico tenga
  // huecos como los tiene en la realidad.
  const INSP = [];
  let id = 0;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  for (let d = 13; d >= 0; d--) {
    if (d === 9 || d === 4) continue; // jornadas sin patrulla
    const fecha = new Date(hoy);
    fecha.setDate(fecha.getDate() - d);
    const cuantos = d === 0 ? entre(8, 14) : entre(24, 42);

    for (let k = 0; k < cuantos; k++) {
      const ng = rnd() < 0.42;
      const cuando = new Date(fecha);
      cuando.setHours(entre(6, 21), entre(0, 59), 0, 0);
      const dv = ng
        ? Array.from({ length: rnd() < 0.25 ? 2 : 1 }, () => uno(desvios))
        : [];
      INSP.push({
        id: ++id,
        uuid: 'preview-' + id,
        registrado_en: cuando.toISOString(),
        resultado: ng ? 'NG' : 'OK',
        // Poco mas de un tercio de los NG traen texto. Estaba fijo en null y el
        // preview nunca mostraba la caja con la observacion plegada -- o sea,
        // escondia justo la parte que habia que mirar.
        detalle: ng && rnd() < 0.35 ? uno(OBSERVACIONES) : null,
        auditor: uno(AUDITORES),
        responsable: uno(responsables),
        equipo: { id: 0, codigo: uno(equipos) },
        demora: ng ? uno(demoras) : null,
        controlador: null,
        estadoControl: null,
        desvios: [...new Map(dv.map((x) => [x.id, x])).values()],
        // `ruta` con archivo de verdad, no null: la app pide `uploads/<ruta>` y
        // con null nunca se veia una foto en el preview. Los .svg de muestra
        // los copia armar.sh a .preview/uploads/.
        // Hasta 6 y no 3: con tres nunca se veia el casillero "+N" de la ficha.
        fotos: Array.from({ length: ng ? entre(1, 6) : entre(0, 1) },
          (_, i) => ({ id: i, orden: i + 1, ruta: `demo-${entre(1, 4)}.svg`, orientacion: 'libre' }))
      });
    }
  }
  /**
   * Los controles cargados desde la app sobreviven a la recarga.
   *
   * Sin esto el mock se portaba PEOR que produccion, no mejor: cargabas un
   * control, lo veias en la lista, recargabas y no estaba. Del otro lado el
   * servidor lo guarda, asi que perderlo escondia el unico camino que importa
   * probar de punta a punta -- cargar, sincronizar, volver a entrar y que este.
   *
   * Van a localStorage y no a IndexedDB a proposito: IndexedDB ya la usa la app
   * para la cola, y mezclar el almacen del mock con el de la app haria que
   * limpiar uno se lleve el otro.
   *
   * Para empezar de cero: abrir con `?limpiar` en la URL.
   */
  const CLAVE = 'yard-preview-controles';

  function leerGuardados() {
    try { return JSON.parse(localStorage.getItem(CLAVE) || '[]'); } catch (e) { return []; }
  }
  function guardarControl(insp) {
    try {
      const a = leerGuardados();
      a.push(insp);
      localStorage.setItem(CLAVE, JSON.stringify(a));
    } catch (e) { /* modo privado o cuota llena: el preview sigue andando */ }
  }

  if (location.search.includes('limpiar')) {
    try { localStorage.removeItem(CLAVE); } catch (e) { /* modo privado */ }
  }

  leerGuardados().forEach((i) => {
    if (INSP.some((x) => x.uuid === i.uuid)) return;   // por si acaso: sin duplicar
    INSP.push(i);
    id = Math.max(id, i.id || 0);                      // que el proximo id no choque
  });

  INSP.sort((a, b) => new Date(b.registrado_en) - new Date(a.registrado_en));

  const json = (o, status) => Promise.resolve(new Response(JSON.stringify(o), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ETag: 'preview' }
  }));

  /**
   * Alta de un control, con el mismo contrato que el servidor real.
   *
   * Esto tiene que estar: sin el, el `if (s.includes('api/inspecciones'))` de
   * abajo atrapaba tambien los POST y contestaba 200 con un listado. La cola lo
   * leia como "guardado" y sacaba el control, asi que la carga *parecia* andar
   * sin probar nada. Un preview que miente es peor que no tenerlo.
   */
  function crear(cuerpo) {
    const b = JSON.parse(cuerpo || '{}');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.uuid || '')) {
      return json({ error: 'uuid_invalido' }, 400);
    }
    if (!b.equipo_codigo) return json({ error: 'equipo_requerido' }, 400);

    // Idempotencia: reenviar el mismo uuid devuelve 200 con lo que ya existe,
    // nunca 409. Con un 409 el cliente no sabe si puede sacarlo de la cola.
    const ya = INSP.find((i) => i.uuid === b.uuid);
    if (ya) return json({ inspeccion: ya, duplicada: true }, 200);

    // Ya no llegan desvios escritos a mano: el boton "No esta en la lista" se
    // saco del formulario. Lo que no esta en el catalogo se carga como
    // "Faltante sin clasificar" y se describe en la observacion.

    const insp = {
      id: ++id,
      uuid: b.uuid,
      registrado_en: b.registrado_en,
      resultado: b.resultado,
      detalle: b.detalle || null,
      auditor: { id: 0, nombre: CATALOGOS.usuario.nombre, email: CATALOGOS.usuario.email },
      responsable: responsables.find((r) => r.id === b.responsable_id) || null,
      equipo: { id: 0, codigo: Number(b.equipo_codigo) },
      demora: demoras.find((d) => d.id === b.demora_id) || null,
      controlador: null,
      estadoControl: null,
      desvios: [
        ...(b.desvio_ids || []).map((x) => desvios.find((d) => d.id === x)).filter(Boolean)
      ].map((d) => ({ id: d.id, nombre: d.nombre })),
      // Con `ruta: null` el control recien cargado quedaba sin foto aunque el
      // inspector hubiera sacado tres. El servidor real devuelve la ruta del
      // archivo que acaba de guardar, asi que aca se devuelve una de muestra.
      fotos: (b.fotos || []).map((_, i) => ({
        id: i, orden: i + 1, ruta: `demo-${(i % 4) + 1}.svg`, orientacion: 'libre'
      }))
    };

    INSP.unshift(insp);
    INSP.sort((a, c) => new Date(c.registrado_en) - new Date(a.registrado_en));
    guardarControl(insp);
    return json({ inspeccion: insp }, 201);
  }

  // ------------------------------------------------------------------ bahias

  /**
   * El checklist, tal cual el papel que hay hoy en cada bahia
   * ("Control de bahias (Para impresion) - Google Sheets").
   *
   * `cantidad_std` es la columna "Cantidad STD" del papel, que viene impresa.
   * Ocho de los doce son 1, pero Escaleras burro son 4 y hay tres de a 2: por
   * eso se cuenta y no se marca presente/ausente -- tres escaleras de cuatro es
   * un faltante que un tilde no ve.
   */
  const ITEMS_BAHIA = [
    ['Distance checkers', 1],
    ['Almohadillas de puertas', 1],
    ['Soportes de carteles', 1],
    ['Arneses de seguridad', 2],
    ['Reglas de medición', 1],
    ['Escaleras burro', 4],
    ['Recapados', 2],
    ['Portallaves', 1],
    ['Stoppers bahías de carga', 1],
    ['Stoppers bahías de espera', 1],
    ['Rampas', 1],
    ['Rampines', 2]
  ].map(([nombre, std], i) => ({ id: i + 1, nombre, cantidad_std: std, orden: i + 1 }));

  /**
   * El token del QR. En produccion lo genera el servidor y va impreso en el
   * sticker: sirve para que la URL no sea adivinable escribiendo `?b=3`. Aca es
   * derivado de la semilla para que el mismo link ande entre corridas.
   */
  const tokenDe = (codigo) => 'b' + codigo + '-' + (codigo * 7919 % 100000).toString(36);

  /**
   * Las 8 bahias de la playa, de las que **se patrullan la 3 a la 8**.
   *
   * La 1 y la 2 quedan en la tabla con `activo: 0` en vez de no existir: la
   * numeracion es fisica, y el dia que se decida controlarlas es prender un
   * flag y no renumerar todo. El endpoint devuelve solo las activas.
   */
  const TODAS = Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    codigo: i + 1,
    nombre: 'Bahía ' + (i + 1),
    token: tokenDe(i + 1),
    activo: i + 1 >= 3,
    control: null
  }));
  const BAHIAS = TODAS.filter((b) => b.activo);

  const CLAVE_B = 'yard-preview-bahias';
  let claveActual = null;

  const leerBahias = () => {
    try { return JSON.parse(localStorage.getItem(CLAVE_B) || '{}'); } catch (e) { return {}; }
  };

  /**
   * Guarda o pisa un control por uuid.
   *
   * Es un upsert y no un push porque las auditorias se agregan **despues** de
   * crear el control: con push, la auditoria vivia solo en memoria y el
   * siguiente GET la borraba. Parecia un bug del front y era del mock.
   */
  const persistir = (clave, ctrl) => {
    if (!clave) return;
    try {
      const a = leerBahias();
      const lista = (a[clave] = a[clave] || []);
      const i = lista.findIndex((c) => c.uuid === ctrl.uuid);
      if (i >= 0) lista[i] = ctrl; else lista.push(ctrl);
      localStorage.setItem(CLAVE_B, JSON.stringify(a));
    } catch (e) { /* modo privado o cuota llena */ }
  };
  if (location.search.includes('limpiar')) {
    try { localStorage.removeItem(CLAVE_B); } catch (e) { /* modo privado */ }
  }

  /**
   * Siembra la ronda del turno en curso: unas cuantas bahias controladas y el
   * resto pendiente. **No las llena todas a proposito** -- una ronda completa
   * esconde justo el estado que la pantalla existe para mostrar.
   */
  function sembrarRonda(clave) {
    claveActual = clave;
    const guardadas = leerBahias()[clave] || [];
    BAHIAS.forEach((b) => { b.control = null; });

    // Las horas salen del turno que se pidio, no de "hace n horas". Sembradas
    // a ojo quedaban a las 06:00 colgando de la ronda de la tarde: el mock
    // contradiciendo su propio dato, que es la clase de mentira que despues se
    // busca en el front.
    const m = /^(\d{4})-(\d{2})-(\d{2})-(manana|tarde)$/.exec(clave);
    const arranque = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] === 'tarde' ? 16 : 6, 0, 0, 0)
      : new Date();
    const ahora = new Date();

    // 4 de las 6 controladas: quedan dos pendientes para que se vea el estado
    // que la pantalla existe para mostrar. Una con novedades, otra con una
    // auditoria encima.
    BAHIAS.slice(0, 4).forEach((b, i) => {
      const conFalta = i === 1;
      // Una cada ~12 minutos desde que abrio el turno, sin pasarse de ahora.
      const hora = new Date(Math.min(arranque.getTime() + i * 12 * 60000, ahora.getTime()));
      b.control = {
        uuid: 'seed-' + clave + '-' + b.codigo,
        // `bahia_id` tiene que estar: al persistir una auditoria se reescribe
        // este control, y sembrarRonda lo vuelve a enganchar por bahia_id. Sin
        // el, la auditoria se guardaba y el siguiente GET la perdia.
        bahia_id: b.id,
        inspector: AUDITORES[i % 2],
        registrado_en: hora.toISOString(),
        items: ITEMS_BAHIA.map((it) => {
          const mal = conFalta && it.id % 5 === (i % 5);
          return {
            item_id: it.id,
            // `conforme` es lo que marco el inspector y es lo que cuenta la
            // pantalla. Sin el, cada item llegaba con conforme undefined y la
            // ficha pintaba las doce herramientas en rojo.
            conforme: !mal,
            cantidad: mal ? Math.max(0, it.cantidad_std - 1) : it.cantidad_std,
            ubicacion_ok: true,
            estado_ok: !mal,
            comentario: mal ? 'Falta una y la que está tiene el cincho cortado.' : null
          };
        }),
        observacion: conFalta ? 'Se pidió reposición al pañol.' : null,
        foto: `demo-${(b.codigo % 4) + 1}.svg`,
        auditorias: i === 2
          ? [{ uuid: 'aud-' + b.codigo, usuario: AUDITORES[1], registrado_en: hora.toISOString(),
               coincide: true, observacion: null, propia: false }]
          : []
      };
    });

    // Encima, lo que se haya cargado en el preview.
    guardadas.forEach((c) => {
      const b = BAHIAS.find((x) => x.id === c.bahia_id);
      if (b) b.control = c;
    });
  }

  /** Alta de un control de bahia, con el mismo contrato que el servidor. */
  function crearBahia(cuerpo) {
    const b = JSON.parse(cuerpo || '{}');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.uuid || '')) {
      return json({ error: 'uuid_invalido' }, 400);
    }
    if (!b.bahia_id) return json({ error: 'bahia_requerida' }, 400);
    if (!b.turno_clave) return json({ error: 'turno_requerido' }, 400);
    // La foto es obligatoria en el servidor tambien: si solo la exigiera el
    // front, alcanzaria con un POST a mano para saltearla.
    if (!b.foto) return json({ error: 'foto_requerida' }, 400);

    // Se busca sobre TODAS y despues se mira `activo`: una bahia que existe
    // pero no se patrulla tiene que decir eso y no "no existe". Con un 404 el
    // dia que se prenda la 1 nadie va a saber por que fallaba.
    const bah = TODAS.find((x) => x.id === b.bahia_id);
    if (!bah) return json({ error: 'bahia_desconocida' }, 404);
    if (!bah.activo) return json({ error: 'bahia_no_se_patrulla' }, 409);

    // Idempotencia por uuid: reenviar devuelve 200 con lo que ya existe.
    if (bah.control && bah.control.uuid === b.uuid) {
      return json({ control: bah.control, duplicada: true }, 200);
    }
    // Una bahia por turno. El segundo control del mismo turno es un 409 del
    // servidor, no algo que el front decida esconder.
    if (bah.control) return json({ error: 'bahia_ya_controlada' }, 409);

    const ctrl = {
      uuid: b.uuid,
      bahia_id: b.bahia_id,
      inspector: { id: 0, nombre: CATALOGOS.usuario.nombre, email: CATALOGOS.usuario.email },
      registrado_en: b.registrado_en,
      items: b.items || [],
      observacion: b.observacion || null,
      foto: `demo-${(b.bahia_id % 4) + 1}.svg`,
      auditorias: []
    };
    bah.control = ctrl;
    persistir(b.turno_clave, ctrl);
    return json({ control: ctrl }, 201);
  }

  /** Alta de una auditoria sobre un control ya hecho. */
  function crearAuditoria(cuerpo) {
    const b = JSON.parse(cuerpo || '{}');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.uuid || '')) {
      return json({ error: 'uuid_invalido' }, 400);
    }
    const bah = BAHIAS.find((x) => x.control && x.control.uuid === b.control_uuid);
    if (!bah) return json({ error: 'control_desconocido' }, 404);
    if (typeof b.coincide !== 'boolean') return json({ error: 'coincide_requerido' }, 400);

    const ya = bah.control.auditorias.find((a) => a.uuid === b.uuid);
    if (ya) return json({ auditoria: ya, duplicada: true }, 200);

    const aud = {
      uuid: b.uuid,
      usuario: { id: 0, nombre: CATALOGOS.usuario.nombre, email: CATALOGOS.usuario.email },
      registrado_en: b.registrado_en,
      coincide: b.coincide,
      observacion: b.observacion || null,
      propia: true
    };
    bah.control.auditorias.push(aud);
    persistir(claveActual, bah.control);
    return json({ auditoria: aud }, 201);
  }

  // ---------------------------------------------------- historial de rondas

  /**
   * Historial inventado pero **estable**: todo sale de un hash de la fecha, asi
   * que el mismo dia se ve igual en cada recarga. Sin eso, el calendario
   * cambiaba de colores al navegar entre meses y era imposible saber si un
   * cambio en pantalla era del codigo o del azar.
   */
  const hashTxt = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  };
  const az = (...partes) => (hashTxt(partes.join('|')) % 1000) / 1000;

  const isoFecha = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  /**
   * Que turnos tuvieron ronda ese dia. Un dia completo son los dos.
   *
   * ⚠ SUPUESTOS, no datos. Bahias no tiene historico -- viene a reemplazar un
   * papel del que no hay registro confiable, que es justamente el problema.
   * Estos numeros hacen que la demo se parezca a una playa y no a un dato
   * perfecto, pero **hay que reemplazarlos por la realidad** cuando se sepa:
   *
   *   - el domingo casi nunca hay ronda;
   *   - cuando se hace una sola, suele ser la de la mañana: el turno que se
   *     saltea es el de la tarde, que termina 00:45 y anda con menos gente.
   *     Sin esta asimetria las barritas de turno del calendario no muestran
   *     nada -- se saltea uno u otro al azar y no hay patron que mirar.
   */
  function turnosDe(fecha) {
    const d = new Date(fecha + 'T12:00:00');
    const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
    if (d > hoy) return [];                       // el futuro no tiene rondas
    if (d.getDay() === 0) return az(fecha, 'dom') < 0.8 ? [] : ['manana'];
    const r = az(fecha, 'cuantas');
    if (r < 0.08) return [];
    if (r < 0.38) return az(fecha, 'cual') < 0.75 ? ['manana'] : ['tarde'];
    return ['manana', 'tarde'];
  }

  /**
   * Peso de cada item para fallar. **No es uniforme a proposito.**
   *
   * Un item de cuatro unidades tiene cuatro chances de que falte una, asi que
   * las Escaleras burro (std 4) fallan mucho mas que un Portallaves (std 1).
   * Con todos los items equiprobables la matriz del historial queda con rojos
   * salpicados al azar y **no muestra lo unico que existe para mostrar**: que
   * la misma herramienta falta en varias bahias.
   */
  const PESO_ITEM = ITEMS_BAHIA.map((it) => it.cantidad_std >= 4 ? 6
    : it.cantidad_std === 2 ? 3 : 1);
  const PESO_TOTAL = PESO_ITEM.reduce((a, b) => a + b, 0);

  /** Elige un item segun su peso. `x` es un numero entre 0 y 1. */
  function itemPesado(x) {
    let acum = x * PESO_TOTAL;
    for (let i = 0; i < PESO_ITEM.length; i++) {
      acum -= PESO_ITEM[i];
      if (acum <= 0) return ITEMS_BAHIA[i].id;
    }
    return ITEMS_BAHIA[ITEMS_BAHIA.length - 1].id;
  }

  const NOMBRE_TURNO = { manana: 'Primer turno', tarde: 'Segundo turno' };

  /** Las bahias de una ronda, con su control o `null` si quedo sin hacer. */
  function bahiasDe(fecha, turno) {
    return BAHIAS.map((b, i) => {
      const semilla = fecha + turno + b.codigo;
      const base = { id: b.id, codigo: b.codigo, nombre: b.nombre, activo: true };
      if (az(semilla, 'hecha') < 0.08) return { ...base, control: null };

      const cuantas = az(semilla, 'nov') < 0.72 ? 0 : (az(semilla, 'cuantas') < 0.75 ? 1 : 2);
      const marcados = new Set();
      for (let k = 0; k < cuantas; k++) marcados.add(itemPesado(az(semilla, 'item' + k)));

      const hora = new Date(fecha + 'T00:00:00');
      hora.setMinutes((turno === 'manana' ? 6 * 60 : 16 * 60) + 20 + i * 11);

      return {
        ...base,
        control: {
          uuid: 'hist-' + semilla,
          bahia_id: b.id,
          inspector: AUDITORES[Math.floor(az(fecha, turno, 'insp') * AUDITORES.length)],
          registrado_en: hora.toISOString(),
          items: ITEMS_BAHIA.map((it) => {
            const mal = marcados.has(it.id);
            return {
              item_id: it.id,
              conforme: !mal,
              cantidad: mal ? Math.max(0, it.cantidad_std - 1) : it.cantidad_std,
              ubicacion_ok: true,
              estado_ok: !mal,
              comentario: mal ? 'Falta una. Se pidió reposición al pañol.' : null
            };
          }),
          observacion: null,
          foto: `demo-${(b.codigo % 4) + 1}.svg`,
          auditorias: []
        }
      };
    });
  }

  /** Resumen por dia, que es lo que pinta el calendario. */
  function resumenRango(desde, hasta) {
    const dias = [];
    const d = new Date((desde || isoFecha(new Date())) + 'T12:00:00');
    const fin = new Date((hasta || desde) + 'T12:00:00');
    let guarda = 0;
    while (d <= fin && guarda++ < 400) {
      const f = isoFecha(d);
      dias.push({
        fecha: f,
        turnos: turnosDe(f).map((t) => {
          const bs = bahiasDe(f, t);
          return {
            turno: t,
            nombre: NOMBRE_TURNO[t],
            hechas: bs.filter((b) => b.control).length,
            total: bs.length,
            novedades: bs.reduce((a, b) => a + (b.control
              ? b.control.items.filter((i) => !i.conforme).length : 0), 0)
          };
        })
      });
      d.setDate(d.getDate() + 1);
    }
    return dias;
  }

  function detalleDia(fecha) {
    const f = fecha || isoFecha(new Date());
    return {
      fecha: f,
      items: ITEMS_BAHIA,
      turnos: turnosDe(f).map((t) => {
        const bahias = bahiasDe(f, t);
        return {
          turno: t,
          nombre: NOMBRE_TURNO[t],
          total: bahias.length,
          hechas: bahias.filter((b) => b.control).length,
          bahias
        };
      })
    };
  }

  /**
   * Lector de QR simulado.
   *
   * El preview corre en una computadora sin camara. Se reemplaza el **hardware**
   * igual que se reemplaza la API, y nada mas: el gate real se sigue ejecutando
   * entero -- compara el token, rechaza el de otra bahia con su mensaje, y no
   * habilita nada si cancelas.
   *
   * Muestra los codigos como botones a proposito, incluido el de otra bahia:
   * poder equivocarse aposta es lo que hace probable que se pruebe el camino de
   * error, que es donde estaban los bugs.
   */
  // `typeof` y no `window.Escaner`: los scripts de la app declaran sus modulos
  // con `const`, que vive en el ambito lexico global pero **no** cuelga de
  // `window`. Con `window.Escaner` el override se salteaba en silencio y el
  // preview quedaba con el lector real, o sea sin lector.
  //
  // **Solo se simula si el navegador NO puede leer QR.** En un telefono Android
  // `BarcodeDetector` existe, y ahi hay que usar la camara de verdad: es el
  // unico modo de probar la funcion como es -- imprimir el cartel, caminar
  // hasta la bahia y escanearlo. Simular ahi convertiria la prueba en una
  // demostracion de botones.
  if (typeof Escaner !== 'undefined' && !('BarcodeDetector' in window)) {
    Escaner.soportado = () => true;
    Escaner.soportaFormatos = () => Promise.resolve(true);
    Escaner.abrir = (titulo, validar, formatos) => new Promise((resolver, rechazar) => {
      // Que ofrece depende de lo que se este por leer. Precarga pide Code 128
      // (la etiqueta de VIN) y bahias QR.
      const esVin = (formatos || []).includes('code_128');
      const caja = document.createElement('div');
      caja.className = 'escaner';
      caja.innerHTML = `
        <p class="escaner-titulo">${titulo} · lector simulado</p>
        <p class="escaner-error" id="sim-error" hidden></p>
        <div style="position:relative;display:grid;gap:8px;width:min(100%,280px)">
          ${esVin ? opcionesVin() : BAHIAS.map((b) => `<button type="button" class="btn sec" data-sim="${b.token}">QR de la bahía ${b.codigo}</button>`).join('')}
          <button type="button" class="btn sec" data-sim="basura-123">${esVin ? 'Un código que no es un VIN' : 'Un QR cualquiera'}</button>
          <button type="button" class="btn" data-sim-cancelar>Cancelar</button>
        </div>`;
      document.body.appendChild(caja);

      caja.addEventListener('click', (e) => {
        if (e.target.closest('[data-sim-cancelar]')) {
          caja.remove();
          rechazar(new Error('cancelado'));
          return;
        }
        const b = e.target.closest('[data-sim]');
        if (!b) return;
        // `data-sim` vacio significa "usar lo que se escribio en el campo".
        const campo = caja.querySelector('#sim-vin');
        const valor = b.dataset.sim || (campo ? campo.value.trim() : '');
        if (!valor) return;
        const veredicto = validar ? validar(valor) : true;
        if (veredicto === true) { caja.remove(); resolver(valor); return; }
        const err = caja.querySelector('#sim-error');
        err.textContent = veredicto;
        err.hidden = false;
      });
    });
  }

  // ---------------------------------------------------------------- precarga

  /**
   * Catalogo de partes y tipos de daño.
   *
   * **Salen de las planillas reales**, cruzando dos documentos:
   *
   * | Documento | Que aporta |
   * |---|---|
   * | `Checklist control de precarga y recepcion.xlsx`, hoja UNID1 | La planilla Furlong: 95 partes numeradas y repartidas en seis sectores, mas los codigos de daño |
   * | `Estado de unidades Precarga.xlsx`, hoja Parte | Las 70 partes del catalogo de AppSheet |
   *
   * **Cuando las dos nombran la misma pieza gana el nombre de "Estado de
   * unidades Precarga"**, que es el que los inspectores ya tienen a la vista.
   * Pasa en 52 de las 95. Las 43 restantes quedan con el nombre de la planilla,
   * y de "Estado" se suman 16 que la planilla no tiene. Total: 111.
   *
   * El `grupo` es el **sector de la planilla Furlong**, que es como el inspector
   * recorre el auto: dos toques en vez de un scroll de cien nombres.
   *
   * Los cajones de sastre se unificaron: **uno solo por sector y con el mismo
   * nombre en los seis**. Donde la planilla ya tenia uno se conserva SU codigo
   * Furlong (54, 55, 98), que es como se reconcilia con el papel; los tres que
   * faltaban van con id propio. Con el comentario obligatorio al lado funcionan
   * como el "Faltante sin clasificar" de patrullas: lo que no esta en la lista se
   * carga ahi y se describe, y despues alguien decide si merece ser una parte.
   *
   * El sector "Extremo derecho" del formulario se renombro a "Extremo trasero",
   * que es lo que tiene adentro. El inspector elige el sector antes que la parte,
   * asi que un nombre que no describe su contenido le cuesta un rodeo por carga.
   *
   * Tres partes se dejaron una sola vez: el Nº 41 esta dos veces en la planilla,
   * y las alfombras 18/19 repiten a las 68/97 -- quedan en Interior, que es
   * donde va un tapete.
   *
   * ⚠ Lo que NO sale de los documentos y hay que confirmar: el sector de esas 16
   * partes agregadas (la planilla no las trae, asi que lo puse yo), y que el
   * sector "Extremo derecho" en realidad agrupa el extremo TRASERO -- son sus
   * propias filas las que lo dicen (luneta trasera, tapa de baul, faro trasero).
   */
  const PARTES = [
    // Frente
    { id: 1, nombre: 'Antena', grupo: 'Frente' },
    { id: 3, nombre: 'Paragolpe delantero', grupo: 'Frente' },
    { id: 5, nombre: 'Protector paragolpe / fleje', grupo: 'Frente' },
    { id: 20, nombre: 'Parabrisas delantero', grupo: 'Frente' },
    { id: 22, nombre: 'Parrilla', grupo: 'Frente' },
    { id: 23, nombre: 'Plancha sup/ext, baul', grupo: 'Frente' },
    { id: 24, nombre: 'Faro cubierta luz de giro', grupo: 'Frente' },
    { id: 25, nombre: 'Luces niebla medias pos', grupo: 'Frente' },
    { id: 27, nombre: 'Capot', grupo: 'Frente' },
    { id: 41, nombre: 'Suplem. paragolpe', grupo: 'Frente' },
    { id: 42, nombre: 'Panel salpicadura del', grupo: 'Frente' },
    { id: 59, nombre: 'Limpiaparabrisas', grupo: 'Frente' },
    { id: 80, nombre: 'Cubretablero', grupo: 'Frente' },
    { id: 1001, nombre: 'Optica delantera derecha', grupo: 'Frente' },
    { id: 1002, nombre: 'Optica delantera izquierda', grupo: 'Frente' },
    { id: 2001, nombre: 'Otros', grupo: 'Frente' },
    // Lateral izquierdo
    { id: 10, nombre: 'Puerta delantera izquierda', grupo: 'Lateral izquierdo' },
    { id: 11, nombre: 'Puerta trasera izquierda', grupo: 'Lateral izquierdo' },
    { id: 14, nombre: 'Guardabarro delantero izquierdo', grupo: 'Lateral izquierdo' },
    { id: 15, nombre: 'Cuarto trasero izq.', grupo: 'Lateral izquierdo' },
    { id: 30, nombre: 'Espejo exterior izquierdo', grupo: 'Lateral izquierdo' },
    { id: 35, nombre: 'Zócalo lateral izquierdo', grupo: 'Lateral izquierdo' },
    { id: 38, nombre: 'Estribo lateral izquierdo', grupo: 'Lateral izquierdo' },
    { id: 70, nombre: 'Pilar medio izquierdo', grupo: 'Lateral izquierdo' },
    { id: 72, nombre: 'Pilar delantero izquierdo', grupo: 'Lateral izquierdo' },
    { id: 74, nombre: 'Pilar trasero izquierdo', grupo: 'Lateral izquierdo' },
    { id: 75, nombre: 'Panel de cabina lat. izq.', grupo: 'Lateral izquierdo' },
    { id: 78, nombre: 'Ext. cuarto trasero izq.', grupo: 'Lateral izquierdo' },
    { id: 82, nombre: 'Guardabarro trasero izquierdo', grupo: 'Lateral izquierdo' },
    { id: 88, nombre: 'Puerta de cabina de cucheta', grupo: 'Lateral izquierdo' },
    { id: 2002, nombre: 'Otros', grupo: 'Lateral izquierdo' },
    // Lateral derecho
    { id: 9, nombre: 'Puerta carga derecha', grupo: 'Lateral derecho' },
    { id: 12, nombre: 'Puerta delantera derecha', grupo: 'Lateral derecho' },
    { id: 13, nombre: 'Puerta trasera derecha', grupo: 'Lateral derecho' },
    { id: 16, nombre: 'Guardabarro delantero derecho', grupo: 'Lateral derecho' },
    { id: 17, nombre: 'Cuarto trasero der.', grupo: 'Lateral derecho' },
    { id: 31, nombre: 'Espejo exterior derecho', grupo: 'Lateral derecho' },
    { id: 36, nombre: 'Zócalo lateral derecho', grupo: 'Lateral derecho' },
    { id: 39, nombre: 'Estribo lateral derecho', grupo: 'Lateral derecho' },
    { id: 69, nombre: 'Pilar medio derecho', grupo: 'Lateral derecho' },
    { id: 71, nombre: 'Pilar delantero derecho', grupo: 'Lateral derecho' },
    { id: 73, nombre: 'Pilar trasero derecho', grupo: 'Lateral derecho' },
    { id: 76, nombre: 'Panel cabina lat. der.', grupo: 'Lateral derecho' },
    { id: 79, nombre: 'Ext. cuarto trasero der.', grupo: 'Lateral derecho' },
    { id: 83, nombre: 'Guardabarro trasero derecho', grupo: 'Lateral derecho' },
    { id: 89, nombre: 'Puerta cabina cucheta derecha (si aplica)', grupo: 'Lateral derecho' },
    { id: 2003, nombre: 'Otros', grupo: 'Lateral derecho' },
    // Extremo trasero
    { id: 4, nombre: 'Paragolpe trasero', grupo: 'Extremo trasero' },
    { id: 6, nombre: 'Protector paragolpe / fleje', grupo: 'Extremo trasero' },
    { id: 7, nombre: 'Puerta carga tras. der.', grupo: 'Extremo trasero' },
    { id: 8, nombre: 'Puerta carga tras. izq.', grupo: 'Extremo trasero' },
    { id: 21, nombre: 'Luneta trasera', grupo: 'Extremo trasero' },
    { id: 34, nombre: 'Panel extremo trasero', grupo: 'Extremo trasero' },
    { id: 40, nombre: 'Neumático / Rueda auxiliar', grupo: 'Extremo trasero' },
    { id: 43, nombre: 'Panel salpicadura tras.', grupo: 'Extremo trasero' },
    { id: 45, nombre: 'Faro trasero / aro', grupo: 'Extremo trasero' },
    { id: 52, nombre: 'Tapa baul / puerta de cola', grupo: 'Extremo trasero' },
    { id: 55, nombre: 'Otros', grupo: 'Extremo trasero' },
    { id: 57, nombre: 'Tazas de ruedas', grupo: 'Extremo trasero' },
    { id: 61, nombre: 'Interior caja pick-up (Hilux)', grupo: 'Extremo trasero' },
    { id: 64, nombre: 'Deflector viento / spoiler', grupo: 'Extremo trasero' },
    { id: 77, nombre: 'Panel cabina trasero', grupo: 'Extremo trasero' },
    { id: 84, nombre: 'Herramientas / Gato / Kit / Traba auxiliar', grupo: 'Extremo trasero' },
    { id: 87, nombre: 'Panel frontal compartim.', grupo: 'Extremo trasero' },
    { id: 92, nombre: 'Soporte chapa patente', grupo: 'Extremo trasero' },
    { id: 1003, nombre: 'Optica trasera derecha', grupo: 'Extremo trasero' },
    { id: 1004, nombre: 'Optica trasera izquierda', grupo: 'Extremo trasero' },
    // Tren inferior, techo y varios
    { id: 2, nombre: 'Batería (visible)', grupo: 'Tren inferior, techo y varios' },
    { id: 37, nombre: 'Techo', grupo: 'Tren inferior, techo y varios' },
    { id: 44, nombre: 'Tanque de nafta', grupo: 'Tren inferior, techo y varios' },
    { id: 47, nombre: 'Neumáticos (no de auxilio)', grupo: 'Tren inferior, techo y varios' },
    { id: 53, nombre: 'Techo corredizo / Capota textil', grupo: 'Tren inferior, techo y varios' },
    { id: 54, nombre: 'Otros', grupo: 'Tren inferior, techo y varios' },
    { id: 56, nombre: 'Cub. techo conv. / vinilico', grupo: 'Tren inferior, techo y varios' },
    { id: 62, nombre: 'Convertidor catalítico', grupo: 'Tren inferior, techo y varios' },
    { id: 63, nombre: 'Largueros - bancada camion', grupo: 'Tren inferior, techo y varios' },
    { id: 65, nombre: 'Portaequipaje / Barras de techo', grupo: 'Tren inferior, techo y varios' },
    { id: 81, nombre: 'Tapa de carga de combustible', grupo: 'Tren inferior, techo y varios' },
    { id: 86, nombre: 'Filtro de aire (visible)', grupo: 'Tren inferior, techo y varios' },
    { id: 90, nombre: 'Bastidor', grupo: 'Tren inferior, techo y varios' },
    { id: 91, nombre: 'Sistema de escape', grupo: 'Tren inferior, techo y varios' },
    { id: 93, nombre: 'Sistema de suspension', grupo: 'Tren inferior, techo y varios' },
    { id: 1000, nombre: 'Vidrios laterales (delanteros y traseros)', grupo: 'Tren inferior, techo y varios' },
    { id: 1005, nombre: 'Sensores de estacionamiento', grupo: 'Tren inferior, techo y varios' },
    { id: 1006, nombre: 'Llantas', grupo: 'Tren inferior, techo y varios' },
    { id: 1015, nombre: 'Radiador (visible)', grupo: 'Tren inferior, techo y varios' },
    // Interior
    { id: 26, nombre: 'Forro de techo', grupo: 'Interior' },
    { id: 28, nombre: 'Llaves', grupo: 'Interior' },
    { id: 29, nombre: 'Espejo interior', grupo: 'Interior' },
    { id: 33, nombre: 'Sistema de audio', grupo: 'Interior' },
    { id: 48, nombre: 'Panel tapizado del. izq.', grupo: 'Interior' },
    { id: 50, nombre: 'Panel tapizado del. der.', grupo: 'Interior' },
    { id: 58, nombre: 'Parlantes', grupo: 'Interior' },
    { id: 66, nombre: 'Tablero digital / velocímetro', grupo: 'Interior' },
    { id: 67, nombre: 'Encendedor / Cenicero', grupo: 'Interior' },
    { id: 68, nombre: 'Alfombra delantera', grupo: 'Interior' },
    { id: 85, nombre: 'Microfono cb / telefono', grupo: 'Interior' },
    { id: 94, nombre: 'Asiento delantero izquierdo', grupo: 'Interior' },
    { id: 95, nombre: 'Asiento delantero derecho', grupo: 'Interior' },
    { id: 96, nombre: 'Asiento trasero', grupo: 'Interior' },
    { id: 97, nombre: 'Alfombra trasera', grupo: 'Interior' },
    { id: 98, nombre: 'Otros', grupo: 'Interior' },
    { id: 1007, nombre: 'Tapizados (asientos y puertas)', grupo: 'Interior' },
    { id: 1008, nombre: 'Cinturones de seguridad (todos)', grupo: 'Interior' },
    { id: 1009, nombre: 'Airbags (conductor, acompañante, laterales, cortina)', grupo: 'Interior' },
    { id: 1010, nombre: 'Volante', grupo: 'Interior' },
    { id: 1011, nombre: 'Palanca de cambios', grupo: 'Interior' },
    { id: 1012, nombre: 'Pantalla multimedia', grupo: 'Interior' },
    { id: 1013, nombre: 'Cámara / sensores (vista interior)', grupo: 'Interior' },
    { id: 1014, nombre: 'Interior compartimiento trasero (Hiace)', grupo: 'Interior' }
  ];

  const TIPOS_DANO = [
    { id: 1, nombre: 'Doblado' },
    { id: 2, nombre: 'Roto (exc. vidrio)' },
    { id: 3, nombre: 'Cortado' },
    { id: 4, nombre: 'Abollado (pintura rota o quebrada)' },
    { id: 5, nombre: 'Mellado (exc. vidrio y bloque de panel)' },
    { id: 6, nombre: 'Quebrado (exc. vidrio)' },
    { id: 7, nombre: 'Rozado' },
    { id: 8, nombre: 'Faltante (exc. moldura)' },
    { id: 9, nombre: 'Raspado' },
    { id: 10, nombre: 'Manchado / sucio int.' },
    { id: 11, nombre: 'Perforado' },
    { id: 12, nombre: 'Rayado (exc. vidrio)' },
    { id: 13, nombre: 'Desgarrado' },
    { id: 14, nombre: 'Abollado pintura, cromado no dañado' },
    { id: 15, nombre: 'Moldura / burlete / emb. dañado' },
    { id: 19, nombre: 'Moldura / burlete / emb. suelto o faltante' },
    { id: 20, nombre: 'Vidrio rajado' },
    { id: 21, nombre: 'Vidrio roto' },
    { id: 22, nombre: 'Vidrio mellado' },
    { id: 23, nombre: 'Vidrio rayado' },
    { id: 24, nombre: 'Luz indicadora dañada' },
    { id: 25, nombre: 'Daño en calcomanía / franja de pintura / veta de madera' },
    { id: 33, nombre: 'Derrame de fluido ext.' },
    { id: 34, nombre: 'Borde panel mellado' },
    { id: 35, nombre: 'Pieza incorrecta' },
    { id: 36, nombre: 'Opcional no facturado' },
    { id: 37, nombre: 'Herrajes ext. dañados' },
    { id: 38, nombre: 'Herrajes exteriores sueltos o faltantes' }
  ];

  const CATALOGOS_PC = { partes: PARTES, tipos_dano: TIPOS_DANO };

  const MODELOS = ['Hilux', 'Corolla Cross', 'Corolla', 'Yaris', 'Hiace', 'SW4'];
  const DESTINOS_PC = ['TOYOTA DO BRASIL LTDA', 'TOYOTA CHILE S.A.', 'DELTA DOCK', 'TOYOSA S.A.'];
  const TRANSPORTISTAS = ['TTFA', 'Autoport', 'Green Mile'];
  const BAHIAS_PC = ['3A', '3B', '5A', '5B', '6B', '7A'];

  /**
   * Un VIN con la forma real: 17 caracteres sin I, O ni Q.
   *
   * El estandar las excluye para que no se confundan con 1 y 0, y el lector de
   * la app se apoya en eso para reconocerlo. Un VIN falso con una O haria pasar
   * un caso que en la playa no existe.
   */
  const LETRAS_VIN = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  function nuevoVin() {
    let v = '8AJ';
    for (let i = 0; i < 6; i++) v += uno((LETRAS_VIN + '0123456789').split(''));
    for (let i = 0; i < 8; i++) v += String(entre(0, 9));
    return v;
  }

  /** Las solicitudes de la jornada, con sus unidades adentro. */
  const SOLICITUDES = (() => {
    const hoy = new Date();
    const out = [];
    for (let i = 0; i < 7; i++) {
      const unidades = [];
      const n = entre(5, 9);
      const destino = uno(DESTINOS_PC);
      for (let k = 0; k < n; k++) {
        unidades.push({
          vin: nuevoVin(),
          orden_solicitado: k + 1,
          so: 'SO-' + entre(10000, 99999),
          katashiki: 'GUN' + entre(120, 145) + 'L',
          modelo: uno(MODELOS),
          destino,
          linea_txt: 'L' + entre(1, 9),
          inspeccion: null
        });
      }
      const h = new Date(hoy);
      h.setHours(7 + i, entre(0, 55), 0, 0);
      out.push({
        id: i + 1,
        codigo: 'SOL-901484' + String(10 + i),
        hora: h.toISOString(),
        transportista: uno(TRANSPORTISTAS),
        equipo: String(entre(120, 7999)),
        bahia: BAHIAS_PC[i % BAHIAS_PC.length],
        destino,
        unidades
      });
    }
    return out;
  })();

  const CLAVE_PC = 'yard-preview-precarga';

  // `?limpiar` tiene que llevarse tambien lo de precarga, o "empezar de cero"
  // deja media demo con datos viejos y la otra media en blanco.
  if (location.search.includes('limpiar')) {
    try { localStorage.removeItem(CLAVE_PC); } catch (e) { /* modo privado */ }
  }

  const leerPC = () => { try { return JSON.parse(localStorage.getItem(CLAVE_PC) || '[]'); } catch (e) { return []; } };

  /**
   * Upsert por uuid, no push.
   *
   * Es el mismo motivo que en bahias: reenviar el mismo uuid tiene que pisar,
   * no duplicar. Con push, reintentar la cola dejaba dos veces la misma unidad
   * y el orden real de bajada saltaba de a dos.
   */
  function persistirPC(reg) {
    const todas = leerPC().filter((x) => x.uuid !== reg.uuid);
    todas.push(reg);
    try { localStorage.setItem(CLAVE_PC, JSON.stringify(todas)); } catch (e) { /* modo privado */ }
  }

  /**
   * Siembra unas cuantas unidades ya bajadas.
   *
   * Una de ellas queda fuera del orden solicitado a proposito: sin eso la
   * pantalla arranca toda verde y el caso que el modulo vino a mostrar --el
   * desvio de orden-- no se ve hasta que alguien lo produzca a mano.
   */
  (function sembrarPC() {
    if (leerPC().length) return;
    const s = SOLICITUDES[0];
    const base = new Date(s.hora).getTime();
    // 1.º, 3.º y 2.º en ese orden: la tercera baja segunda y queda desviada.
    [0, 2, 1].forEach((idx, i) => {
      persistirPC({
        uuid: 'sembrada-' + s.id + '-' + idx,
        solicitud_id: s.id,
        vin: s.unidades[idx].vin,
        escaneado_en: new Date(base + (i + 1) * 6 * 60000).toISOString(),
        registrado_en: new Date(base + (i + 1) * 6 * 60000 + 90000).toISOString(),
        danos: idx === 2
          ? [{ parte_id: 5, tipo_dano_id: 1, comentario: 'En el filo, lado interno', foto: 'uploads/demo-2.svg' }]
          : []
      });
    });
  })();

  /** Las solicitudes con lo guardado encima. El servidor real haria el join. */
  function solicitudesConEstado() {
    const guardadas = new Map();
    for (const r of leerPC()) guardadas.set(r.solicitud_id + '|' + r.vin, r);

    return SOLICITUDES.map((s) => ({
      ...s,
      unidades: s.unidades.map((u) => {
        const r = guardadas.get(s.id + '|' + u.vin);
        return { ...u, inspeccion: r ? {
          uuid: r.uuid,
          escaneado_en: r.escaneado_en,
          registrado_en: r.registrado_en,
          danos: r.danos || []
        } : null };
      })
    }));
  }

  /**
   * Alta de la inspeccion de una unidad, con el mismo contrato que el servidor.
   *
   * Tiene que estar por lo mismo que `crear()` mas arriba: sin el, un
   * `includes('api/precarga')` mas general atraparia tambien el POST y
   * contestaria 200 con un listado. La cola lo leeria como guardado y la carga
   * *pareceria* andar sin probar nada.
   */
  function crearUnidad(cuerpo) {
    const b = JSON.parse(cuerpo || '{}');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.uuid || '')) {
      return json({ error: 'uuid_invalido' }, 400);
    }
    if (!b.vin || !b.solicitud_id) return json({ error: 'unidad_requerida' }, 400);
    if (!b.escaneado_en) return json({ error: 'escaneo_requerido' }, 400);

    const s = SOLICITUDES.find((x) => String(x.id) === String(b.solicitud_id));
    if (!s || !s.unidades.some((u) => u.vin === b.vin)) return json({ error: 'vin_no_es_de_la_solicitud' }, 409);

    // La foto del daño es obligatoria en el servidor, no solo en el front. Una
    // regla que vive nada mas que en el cliente no es una regla.
    for (const d of b.danos || []) {
      if (!d.foto) return json({ error: 'foto_de_dano_requerida' }, 400);
    }

    // Idempotencia: reenviar el mismo uuid devuelve 200 con lo que ya existe,
    // nunca 409. Con un 409 el cliente no sabe si puede sacarlo de la cola.
    const ya = leerPC().find((x) => x.uuid === b.uuid);
    if (ya) return json({ inspeccion: ya, duplicada: true }, 200);

    const reg = {
      uuid: b.uuid,
      solicitud_id: b.solicitud_id,
      vin: b.vin,
      escaneado_en: b.escaneado_en,
      registrado_en: b.registrado_en || new Date().toISOString(),
      // Las fotos se guardan como ruta, igual que en produccion. Si el preview
      // devolviera el base64 que le llego, el front tendria que tratarlas
      // distinto que a las del servidor y ese camino quedaria sin probar.
      foto_panoramica: b.foto_panoramica ? 'uploads/demo-1.svg' : null,
      danos: (b.danos || []).map((d) => ({
        parte_id: d.parte_id,
        tipo_dano_id: d.tipo_dano_id,
        comentario: d.comentario || null,
        foto: 'uploads/demo-' + entre(1, 4) + '.svg'
      }))
    };
    persistirPC(reg);
    return json({ inspeccion: reg }, 201);
  }

  /**
   * Las solicitudes de una jornada pasada.
   *
   * Se generan a partir de la clave, no se guardan: con una semilla derivada del
   * texto de la clave, la misma jornada devuelve siempre lo mismo y dos corridas
   * muestran igual. Es el mismo criterio que `sembrarRonda` en bahias.
   *
   * Las de jornadas viejas vienen `cerrada: true`. El front usa eso para no
   * ofrecer el escaneo: el camion ya salio, y sumarle una unidad despues seria
   * decir que se vio lo que no se vio.
   */
  const CACHE_JORNADAS = new Map();

  function solicitudesDeJornada(clave) {
    if (CACHE_JORNADAS.has(clave)) return CACHE_JORNADAS.get(clave);

    // Semilla propia, derivada del texto: no se toca la del resto del mock, que
    // ya consumio su secuencia y quedaria distinta segun que pantalla se abrio
    // primero.
    let s = 7;
    for (let i = 0; i < clave.length; i++) s = (s * 31 + clave.charCodeAt(i)) % 2147483647;
    const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ent = (a, b) => a + Math.floor(r() * (b - a + 1));
    const un = (a) => a[Math.floor(r() * a.length)];

    const [anio, mes, dia, turnoId] = clave.split('-');
    const base = new Date(Number(anio), Number(mes) - 1, Number(dia), turnoId === 'tarde' ? 16 : 6, 0, 0);

    const out = [];
    const n = ent(3, 6);
    for (let i = 0; i < n; i++) {
      const destino = un(DESTINOS_PC);
      const cuantas = ent(4, 9);
      const unidades = [];

      // El orden real: se baja casi siempre en orden y de vez en cuando no. Si
      // fuera al azar, el desvio dejaria de ser la excepcion que es.
      const bajadas = [...Array(cuantas).keys()];
      if (r() < 0.35) {
        const k = ent(0, cuantas - 2);
        [bajadas[k], bajadas[k + 1]] = [bajadas[k + 1], bajadas[k]];
      }
      const momento = new Map();
      bajadas.forEach((idx, pos) => momento.set(idx, new Date(base.getTime() + (i * 40 + pos * 5) * 60000).toISOString()));

      for (let k = 0; k < cuantas; k++) {
        let vin = '8AJ';
        for (let j = 0; j < 6; j++) vin += (LETRAS_VIN + '0123456789')[Math.floor(r() * 33)];
        for (let j = 0; j < 8; j++) vin += String(ent(0, 9));

        const conDano = r() < 0.22;
        unidades.push({
          vin,
          orden_solicitado: k + 1,
          so: 'SO-' + ent(10000, 99999),
          katashiki: 'GUN' + ent(120, 145) + 'L',
          modelo: un(MODELOS),
          destino,
          linea_txt: 'L' + ent(1, 9),
          inspeccion: {
            uuid: 'hist-' + clave + '-' + i + '-' + k,
            escaneado_en: momento.get(k),
            registrado_en: momento.get(k),
            danos: conDano ? [{
              parte_id: un(PARTES).id,
              tipo_dano_id: un(TIPOS_DANO).id,
              comentario: null,
              foto: 'uploads/demo-' + ent(1, 4) + '.svg'
            }] : []
          }
        });
      }

      const h = new Date(base.getTime() + i * 40 * 60000);
      out.push({
        id: clave + '-' + (i + 1),
        codigo: 'SOL-9014' + String(1000 + ent(0, 8999)),
        hora: h.toISOString(),
        transportista: un(TRANSPORTISTAS),
        equipo: String(ent(120, 7999)),
        bahia: BAHIAS_PC[i % BAHIAS_PC.length],
        destino,
        cerrada: true,
        unidades
      });
    }

    CACHE_JORNADAS.set(clave, out);
    return out;
  }

  /** Las jornadas cerradas, ya agregadas. El servidor real haria los COUNT. */
  function jornadasCerradas(cuantas) {
    const hoy = new Date();
    const actual = Turnos.de(hoy).clave;
    const out = [];

    for (let d = 0; d < 10 && out.length < (cuantas || 14); d++) {
      const dia = new Date(hoy);
      dia.setDate(dia.getDate() - d);
      const y = dia.getFullYear();
      const m = String(dia.getMonth() + 1).padStart(2, '0');
      const dd = String(dia.getDate()).padStart(2, '0');

      for (const t of ['tarde', 'manana']) {
        const clave = `${y}-${m}-${dd}-${t}`;
        if (clave === actual) continue;   // la jornada en curso no es historial
        if (new Date(y, dia.getMonth(), Number(dd)) > hoy) continue;

        const sols = solicitudesDeJornada(clave);
        let unidades = 0, conDano = 0, desviadas = 0;
        for (const s of sols) {
          const orden = new Map();
          s.unidades.slice()
            .sort((a, b) => String(a.inspeccion.escaneado_en).localeCompare(String(b.inspeccion.escaneado_en)))
            .forEach((u, i) => orden.set(u.vin, i + 1));
          for (const u of s.unidades) {
            unidades++;
            if (u.inspeccion.danos.length) conDano++;
            if (orden.get(u.vin) !== u.orden_solicitado) desviadas++;
          }
        }
        out.push({ clave, solicitudes: sols.length, unidades, con_dano: conDano, desviadas });
      }
    }
    return out;
  }

  /**
   * Los botones del lector simulado cuando lo que se pide es un VIN.
   *
   * Los casos malos van a proposito: una unidad ya bajada y un VIN que no esta
   * en ninguna solicitud. **El mock no puede portarse mejor que produccion** --
   * si solo ofreciera VINs validos, los cuatro rechazos del lector no se
   * probarian nunca y el aviso podria estar roto sin que nadie lo notara.
   *
   * Ademas hay un campo para escribir: la pantalla de la solicitud muestra sus
   * VINs, asi que se puede copiar uno y probar el gate de una unidad puntual,
   * que es donde el lector exige ese VIN y no otro.
   */
  function opcionesVin() {
    const sols = solicitudesConEstado();
    const todas = sols.flatMap((s) => s.unidades.map((u) => ({ u, s })));

    const libres = todas.filter((x) => !x.u.inspeccion).slice(0, 5)
      .map((x) => ({ vin: x.u.vin, txt: `${x.u.vin} · ${x.s.codigo}` }));

    const bajada = todas.find((x) => x.u.inspeccion);
    if (bajada) libres.push({ vin: bajada.u.vin, txt: bajada.u.vin + ' · ya bajada' });
    libres.push({ vin: '8AJZZ99ZZ99999999', txt: 'Un VIN de otra playa' });

    return libres.map((b) =>
      `<button type="button" class="btn sec" data-sim="${b.vin}">${b.txt}</button>`).join('')
      + '<input id="sim-vin" placeholder="…o pegá un VIN" style="padding:9px;border-radius:4px;border:1px solid #555;background:#111;color:#fff;font-family:monospace">'
      + '<button type="button" class="btn sec" data-sim="">Usar el VIN escrito</button>';
  }

  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const s = String(url && url.url ? url.url : url);
    if (!s.includes('api/')) return real(url, opts);

    const metodo = ((opts && opts.method) || 'GET').toUpperCase();
    if (metodo === 'POST' && s.includes('api/bahias/control')) return crearBahia(opts && opts.body);
    if (metodo === 'POST' && s.includes('api/bahias/auditoria')) return crearAuditoria(opts && opts.body);
    if (metodo === 'POST' && s.includes('api/precarga/inspecciones')) return crearUnidad(opts && opts.body);
    if (metodo === 'POST' && s.includes('api/inspecciones')) return crear(opts && opts.body);

    if (s.includes('api/bahias/dia')) {
      const q = new URLSearchParams(s.split('?')[1] || '');
      return json(detalleDia(q.get('fecha')));
    }

    if (s.includes('api/bahias/rondas')) {
      const q = new URLSearchParams(s.split('?')[1] || '');
      return json({ dias: resumenRango(q.get('desde'), q.get('hasta')) });
    }

    if (s.includes('api/bahias')) {
      const q = new URLSearchParams(s.split('?')[1] || '');
      const clave = q.get('turno') || 'sin-turno';
      sembrarRonda(clave);
      return json({
        turno: { clave },
        items: ITEMS_BAHIA,
        bahias: BAHIAS
      });
    }

    if (s.includes('api/precarga/catalogos')) return json(CATALOGOS_PC);

    if (s.includes('api/precarga/jornadas')) {
      const q = new URLSearchParams(s.split('?')[1] || '');
      return json({ jornadas: jornadasCerradas(Number(q.get('limite') || 14)) });
    }

    if (s.includes('api/precarga/solicitudes')) {
      const q = new URLSearchParams(s.split('?')[1] || '');
      const clave = q.get('jornada') || 'sin-jornada';
      // La jornada en curso sale de lo que se cargo; las anteriores se generan.
      const actual = Turnos.de(new Date()).clave;
      return json({
        jornada: clave,
        solicitudes: clave === actual ? solicitudesConEstado() : solicitudesDeJornada(clave)
      });
    }

    if (s.includes('api/catalogos')) return json(CATALOGOS);


    const m = s.match(/api\/inspecciones\/equipo\/(\d+)/);
    if (m) {
      const cod = Number(m[1]);
      const mias = INSP.filter((i) => i.equipo.codigo === cod);
      const ng = mias.filter((i) => i.resultado === 'NG').length;
      return json({ equipo: { id: cod, codigo: cod }, total: mias.length, ng, ok: mias.length - ng, ultima: mias[0] || null });
    }

    if (s.includes('api/inspecciones')) {
      const q = new URLSearchParams(s.split('?')[1] || '');
      let filas = INSP.slice();
      if (q.get('equipo')) filas = filas.filter((i) => i.equipo.codigo === Number(q.get('equipo')));
      if (q.get('resultado')) filas = filas.filter((i) => i.resultado === q.get('resultado'));
      if (q.get('desde')) {
        const d = new Date(q.get('desde'));
        filas = filas.filter((i) => new Date(i.registrado_en) >= d);
      }
      const total = filas.length;
      const off = Number(q.get('offset') || 0);
      const lim = Number(q.get('limite') || 100);
      return json({ inspecciones: filas.slice(off, off + lim), total, limite: lim, offset: off });
    }

    return real(url, opts);
  };

  console.log('[preview]', INSP.length, 'inspecciones ·', desvios.length, 'desvios · datos falsos');
})();
