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

  /** Que turnos tuvieron ronda ese dia. Un dia completo son los dos. */
  function turnosDe(fecha) {
    const d = new Date(fecha + 'T12:00:00');
    const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
    if (d > hoy) return [];                       // el futuro no tiene rondas
    if (d.getDay() === 0) return az(fecha, 'dom') < 0.7 ? [] : ['manana'];
    const r = az(fecha, 'cuantas');
    if (r < 0.10) return [];
    if (r < 0.34) return [az(fecha, 'cual') < 0.5 ? ['manana'] : ['tarde']].flat();
    return ['manana', 'tarde'];
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
      for (let k = 0; k < cuantas; k++) {
        marcados.add(1 + Math.floor(az(semilla, 'item' + k) * ITEMS_BAHIA.length));
      }

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
    Escaner.abrir = (titulo, validar) => new Promise((resolver, rechazar) => {
      const caja = document.createElement('div');
      caja.className = 'escaner';
      caja.innerHTML = `
        <p class="escaner-titulo">${titulo} · lector simulado</p>
        <p class="escaner-error" id="sim-error" hidden></p>
        <div style="position:relative;display:grid;gap:8px;width:min(100%,280px)">
          ${BAHIAS.map((b) => `<button type="button" class="btn sec" data-sim="${b.token}">QR de la bahía ${b.codigo}</button>`).join('')}
          <button type="button" class="btn sec" data-sim="basura-123">Un QR cualquiera</button>
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
        const veredicto = validar ? validar(b.dataset.sim) : true;
        if (veredicto === true) { caja.remove(); resolver(b.dataset.sim); return; }
        const err = caja.querySelector('#sim-error');
        err.textContent = veredicto;
        err.hidden = false;
      });
    });
  }

  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const s = String(url && url.url ? url.url : url);
    if (!s.includes('api/')) return real(url, opts);

    const metodo = ((opts && opts.method) || 'GET').toUpperCase();
    if (metodo === 'POST' && s.includes('api/bahias/control')) return crearBahia(opts && opts.body);
    if (metodo === 'POST' && s.includes('api/bahias/auditoria')) return crearAuditoria(opts && opts.body);
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
