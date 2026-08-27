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
      fotos: (b.fotos || []).map((_, i) => ({ id: i, orden: i + 1, ruta: null, orientacion: 'libre' }))
    };

    INSP.unshift(insp);
    INSP.sort((a, c) => new Date(c.registrado_en) - new Date(a.registrado_en));
    return json({ inspeccion: insp }, 201);
  }

  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const s = String(url && url.url ? url.url : url);
    if (!s.includes('api/')) return real(url, opts);

    const metodo = ((opts && opts.method) || 'GET').toUpperCase();
    if (metodo === 'POST' && s.includes('api/inspecciones')) return crear(opts && opts.body);

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
