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
  const TIPOS = ['5s', 'Mantenimiento', 'Seguridad', 'Calidad'];
  const DEMORAS = ['Cargo', 'Se retira', 'Demora en carga'];
  const AUDITORES = [
    { id: 1, nombre: 'Lucas Pintos', email: 'lpintos@ttfasa.com' },
    { id: 2, nombre: 'Ariel Almirón', email: 'aalmiron@ttfasa.com' }
  ];

  // El catalogo sale de las zonas, que es el mismo mapa que usa la app.
  const desvios = [];
  Zonas.MAPA.forEach((z) => z.items.forEach((nombre) => {
    desvios.push({ id: desvios.length + 1, nombre, tipo_desvio_id: null, requiere_detalle: false, activo: true, usos_historicos: 0 });
  }));
  // Uno que no esta en ninguna zona, para ver que "Otros" aparece.
  desvios.push({ id: desvios.length + 1, nombre: 'Faltante sin clasificar', activo: true, revisar: true, usos_historicos: 0 });

  const tipos = TIPOS.map((n, i) => ({ id: i + 1, nombre: n }));
  const demoras = DEMORAS.map((n, i) => ({ id: i + 1, nombre: n }));
  const responsables = TRAFICOS.map((n, i) => ({ id: i + 1, nombre: 'Trafico ' + n }));
  const equipos = Array.from({ length: 60 }, () => entre(120, 7999)).sort((a, b) => a - b);

  const CATALOGOS = {
    usuario: { email: 'tpozo@ttfasa.com', nombre: 'Tomás Pozo' },
    responsables,
    tipos_desvio: tipos,
    desvios,
    demoras,
    controladores: ['Feria', 'Cordero', 'Nores'].map((n, i) => ({ id: i + 1, nombre: n })),
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
        detalle: null,
        auditor: uno(AUDITORES),
        responsable: uno(responsables),
        equipo: { id: 0, codigo: uno(equipos) },
        tipo: ng ? uno(tipos) : null,
        demora: ng ? uno(demoras) : null,
        controlador: null,
        estadoControl: null,
        desvios: [...new Map(dv.map((x) => [x.id, x])).values()],
        fotos: Array.from({ length: ng ? entre(1, 3) : entre(0, 1) },
          (_, i) => ({ id: i, orden: i + 1, ruta: null, orientacion: 'libre' }))
      });
    }
  }
  INSP.sort((a, b) => new Date(b.registrado_en) - new Date(a.registrado_en));

  const json = (o) => Promise.resolve(new Response(JSON.stringify(o), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: 'preview' }
  }));

  const real = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    const s = String(url && url.url ? url.url : url);
    if (!s.includes('api/')) return real(url, opts);

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
