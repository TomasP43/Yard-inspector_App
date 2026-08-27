'use strict';

/**
 * Datos falsos del tablero de gerencia.
 *
 * Define `window.TABLERO` con **la forma exacta que tiene que devolver
 * `GET api/tablero`** (ver YI-004 en REQUERIMIENTOS.md). Si el contrato cambia,
 * esto tiene que cambiar con el o el preview empieza a mentir.
 *
 * Los ordenes de magnitud salen del historico real, incluido el dato incomodo:
 * **hasta jun-2026 el OK no se cargaba**. El formulario se llenaba solo cuando
 * habia algo para reportar, asi que esas 2.809 filas son 100% NG y no se sabe
 * sobre cuantos controles salieron. No es que no se distinguiera OK de NG --
 * es que el OK no existia como registro. Esos meses van con `n: null`.
 *
 * NO se despliega. Solo lo carga tools/preview/armar.sh dentro de .preview/.
 */
(() => {
  let semilla = 20260826;
  const rnd = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  const entre = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const uno = (a) => a[Math.floor(rnd() * a.length)];

  const TIPOS = ['5s', 'Mantenimiento', 'Seguridad', 'Calidad'];
  const TRAFICOS = ['Brasil', 'Autoport', 'Chile', 'Paraguay', 'Bolivia'];
  const DESVIOS = [
    'Óxido en batea', 'Suciedad en batea', 'Óxido avanzado en batea',
    'Fisura en parabrisa', 'Lona en mal estado', 'Óxido y suciedad en batea',
    'Parabrisa polarizado / acrílico', 'Matafuego vencido', 'Sunchos sin acomodar',
    'Caño de batea desoldado', 'Rampa desoldada / caída', 'Neumático gastado',
    'Guitarra desoldada / quebrada / fisurada', 'Sin soga precinto'
  ];

  const MESES = ['sep', 'oct', 'nov', 'dic', 'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago'];
  const ANIOS = ['25', '25', '25', '25', '26', '26', '26', '26', '26', '26', '26', '26'];
  const NUM = ['09', '10', '11', '12', '01', '02', '03', '04', '05', '06', '07', '08'];

  // ------------------------------------------------------------ serie anual
  //
  // Tres cantidades distintas, y el chiste esta en cual falta cuando:
  //
  //   volumen  camiones movidos. Se sabe siempre, sale de operaciones.
  //   ng       observaciones. Se sabe siempre.
  //   n        controles hechos (OK + NG). **Solo desde jun-2026.**
  //
  // Hasta mayo de 2026 el OK no se cargaba: el formulario se llenaba unicamente
  // cuando habia algo para reportar. Por eso esas filas son 100% NG y no se
  // sabe sobre cuantos controles salieron -- `n: null`, no cero. Con cero la
  // pantalla dice que no se controlo nada; con `n = ng` diria que todo control
  // termino mal. Las dos cosas son mentira: el dato que falta es el denominador.
  //
  // Numeros inventados, como todo este archivo. La forma es la de verdad.
  // El corte es jul-2026: los dos ultimos meses de la ventana.
  const CORTE = MESES.length - 2;

  const serieAnual = MESES.map((m, i) => {
    const volumen = entre(700, 2600);
    const conControles = i >= CORTE;
    const ng = entre(80, 340);
    const n = conControles ? ng + entre(150, 380) : null;
    const rechazo = entre(4, 42);
    // Retiros y demoras son subconjuntos del NG: solo un equipo observado se
    // retira o demora la carga. Por eso nunca pueden superar a `ng`.
    const demora = Math.min(ng - rechazo, entre(2, 14));
    return {
      label: `${m} '${ANIOS[i]}`,
      clave: `20${ANIOS[i]}-${NUM[i]}`,
      volumen,
      n,
      ng,
      demora,
      // La tasa del grafico es SIEMPRE sobre camiones movidos. Es la unica que
      // se puede calcular los doce meses, asi que es la unica comparable de
      // punta a punta. La tasa sobre controles existe tambien, pero solo desde
      // jul-2026, y vive en los KPIs -- no en la serie.
      obsPct: Math.round((ng / volumen) * 1000) / 10,
      rechazo,
      rechazoPct: Math.round((rechazo / volumen) * 1000) / 10
    };
  });

  /**
   * Semaforo de retiros: grafico de control por proporciones (p-chart).
   *
   * `z` es a cuantos errores estandar esta la tasa del mes del promedio. El
   * error estandar es binomial y **depende del volumen del mes**: uno de 750
   * camiones rebota mucho mas que uno de 2.600 sin que nada haya cambiado. Con
   * un umbral fijo, ene con 12 retiros se veria tan grave como jun con 41.
   *
   * El promedio va ponderado -- retiros totales sobre movidos totales -- y no
   * como promedio de los doce porcentajes, que le daria el mismo peso a un mes
   * de 750 camiones que a uno de 2.600.
   *
   * Nada de esto tiene un numero escrito a mano: si el volumen o la tasa
   * cambian de nivel, los cortes se recalculan solos.
   */
  function marcarZ(serie) {
    const ret = serie.reduce((a, m) => a + (m.rechazo || 0), 0);
    const vol = serie.reduce((a, m) => a + (m.volumen || 0), 0);
    const p = vol ? ret / vol : 0;
    serie.forEach((m) => {
      const s = m.volumen ? Math.sqrt((p * (1 - p)) / m.volumen) : 0;
      m.retiroZ = s ? Math.round(((m.rechazo / m.volumen - p) / s) * 10) / 10 : null;
    });
    return Math.round(p * 1000) / 10;
  }

  const conControlesAnual = serieAnual.filter((m) => m.n != null);
  const totalAnual = conControlesAnual.reduce((a, m) => a + m.n, 0);
  const obsAnual = serieAnual.reduce((a, m) => a + m.ng, 0);
  const volumenAnual = serieAnual.reduce((a, m) => a + m.volumen, 0);
  const retirosAnual = serieAnual.reduce((a, m) => a + m.rechazo, 0);
  // Filas cargadas en la ventana: las observaciones de todos los meses mas los
  // OK de los meses que los tienen. No es `totalAnual`, que son controles.
  const filasAnual = obsAnual + conControlesAnual.reduce((a, m) => a + (m.n - m.ng), 0);

  function pareto(cuantos) {
    const base = DESVIOS.slice(0, cuantos).map((name, i) => ({
      name, count: Math.round(900 / Math.pow(1.55, i)) + entre(-8, 8)
    })).filter((p) => p.count > 0);
    const total = base.reduce((a, p) => a + p.count, 0) || 1;
    let acum = 0;
    return base.map((p) => {
      acum += p.count;
      return { ...p, cumPct: Math.round((acum / total) * 100) };
    });
  }

  const statsAnual = {
    n: totalAnual,
    mesesConControles: conControlesAnual.length,
    observaciones: obsAnual,
    volumen: volumenAnual,
    obsPct: Math.round((obsAnual / volumenAnual) * 1000) / 10,
    retiroProm: marcarZ(serieAnual),

    // El embudo de los KPIs: controles -> NG -> retiros y demoras. Las cuatro
    // cifras salen de los MISMOS meses, que son los que tienen control cargado.
    // Mezclar retiros de doce meses con controles de dos daria un porcentaje
    // que no es de nada.
    embudo: {
      meses: conControlesAnual.length,
      n: totalAnual,
      ng: conControlesAnual.reduce((a, m) => a + m.ng, 0),
      rechazo: conControlesAnual.reduce((a, m) => a + m.rechazo, 0),
      demora: conControlesAnual.reduce((a, m) => a + m.demora, 0),
      volumen: conControlesAnual.reduce((a, m) => a + m.volumen, 0)
    },
    ngPct: Math.round((conControlesAnual.reduce((a, m) => a + m.ng, 0) / totalAnual) * 100),
    okPct: null,
    rechazo: retirosAnual, demoraCarga: 75, criticoPct: 12,
    pareto: pareto(12)
  };
  statsAnual.okPct = 100 - statsAnual.ngPct;

  // ----------------------------------------------------------- serie mensual
  const hoy = new Date();
  const diasMes = hoy.getDate();
  const serieMensual = Array.from({ length: diasMes }, (_, i) => {
    const dia = i + 1;
    // Un par de dias sin patrulla: los fines de semana existen.
    const sin = dia % 7 === 0 || dia % 7 === 6;
    // El mes en curso es posterior a jun-2026, asi que aca los controles se
    // saben todos: `n` nunca es null. Un dia sin patrulla es n=0, que es otra
    // cosa -- se controlo nada, no es que no se sepa cuanto se controlo.
    const n = sin ? 0 : entre(14, 42);
    const ngPct = n ? entre(38, 60) : null;
    const volumen = sin ? 0 : entre(60, 130);
    const ng = n ? Math.round((n * ngPct) / 100) : null;
    const rechazo = n ? entre(0, 3) : 0;
    const demora = n ? Math.min(Math.max(0, ng - rechazo), entre(0, 2)) : 0;
    return {
      label: String(dia).padStart(2, '0'),
      clave: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
      volumen,
      n,
      ng,
      demora,
      obsPct: volumen ? Math.round((ng / volumen) * 1000) / 10 : null,
      rechazo,
      // Mismo denominador que la barra y que la serie anual. Estaba inventado
      // aparte con `entre(0, 12)`, asi que el punto de la linea y su porcentaje
      // no tenian nada que ver entre si.
      rechazoPct: volumen ? Math.round((rechazo / volumen) * 1000) / 10 : null
    };
  });

  const totalMes = serieMensual.reduce((a, d) => a + d.n, 0);
  const retirosMes = serieMensual.reduce((a, d) => a + d.rechazo, 0);
  const statsMensual = {
    n: totalMes,
    mesesConControles: serieMensual.filter((d) => d.n > 0).length,
    observaciones: serieMensual.reduce((a, d) => a + (d.ng || 0), 0),
    volumen: serieMensual.reduce((a, d) => a + d.volumen, 0),
    obsPct: 12.4,
    retiroProm: marcarZ(serieMensual),
    // El mes en curso es posterior al corte: todos los dias tienen control
    // cargado, asi que el embudo es el mes entero.
    embudo: {
      meses: null,
      n: totalMes,
      ng: serieMensual.reduce((a, d) => a + (d.ng || 0), 0),
      rechazo: retirosMes,
      demora: serieMensual.reduce((a, d) => a + d.demora, 0),
      volumen: serieMensual.reduce((a, d) => a + d.volumen, 0)
    },
    ngPct: 44, okPct: 56,
    rechazo: retirosMes, demoraCarga: 9, criticoPct: 14,
    pareto: pareto(9)
  };

  // -------------------------------------------------------------- detalles
  const monthDetail = {};
  serieAnual.forEach((m) => {
    monthDetail[m.clave] = {
      label: m.label, volumen: m.volumen, n: m.n, ng: m.ng, rechazo: m.rechazo,
      demora: m.demora,
      topDesvios: DESVIOS.slice(0, 5).map((name, i) => ({ name, count: entre(6, 90 - i * 12) })),
      topEquipos: Array.from({ length: 5 }, () => ({ name: String(entre(120, 7999)), count: entre(2, 9) })),
      rechazoList: Array.from({ length: entre(0, 6) }, () => ({
        dayLabel: `${String(entre(1, 28)).padStart(2, '0')} ${m.label.slice(0, 3)}`,
        eq: String(entre(120, 7999)),
        desvio: uno(DESVIOS)
      }))
    };
  });

  const dayDetail = {};
  serieMensual.forEach((d) => {
    if (!d.n) return;
    dayDetail[d.clave] = {
      label: `${d.label} ${MESES[11]}`, volumen: d.volumen, n: d.n, ng: d.ng,
      rechazo: d.rechazo, demora: d.demora,
      rows: Array.from({ length: d.n }, () => {
        const ng = rnd() < 0.45;
        return {
          time: `${String(entre(6, 21)).padStart(2, '0')}:${String(entre(0, 59)).padStart(2, '0')}`,
          eq: String(entre(120, 7999)),
          trafico: uno(TRAFICOS),
          cat: ng ? uno(TIPOS) : null,
          ng,
          desvio: ng ? uno(DESVIOS) : ''
        };
      }).sort((a, b) => a.time.localeCompare(b.time))
    };
  });

  // --------------------------------------------------------------- impacto
  // El hallazgo que el diseño pone en primer plano: 5s es el de mayor volumen
  // y casi nunca frena un camion; Calidad es chico y frena un tercio.
  const cats = [
    { name: '5s', Cargo: 1723, 'Demora en carga': 9, 'Se retira': 14, n: 1746, frenoPct: 1 },
    { name: 'Mantenimiento', Cargo: 674, 'Demora en carga': 15, 'Se retira': 150, n: 839, frenoPct: 20 },
    { name: 'Seguridad', Cargo: 312, 'Demora en carga': 23, 'Se retira': 81, n: 416, frenoPct: 25 },
    { name: 'Calidad', Cargo: 223, 'Demora en carga': 42, 'Se retira': 58, n: 323, frenoPct: 31 }
  ];
  const impTotal = cats.reduce((a, c) => a + c.n, 0);

  const impacto = {
    total: impTotal,
    outcome: [
      { key: 'Cargo', n: cats.reduce((a, c) => a + c.Cargo, 0) },
      { key: 'Demora en carga', n: cats.reduce((a, c) => a + c['Demora en carga'], 0) },
      { key: 'Se retira', n: cats.reduce((a, c) => a + c['Se retira'], 0) }
    ],
    cats,
    topFreno: [
      { name: 'Caño de batea desoldado', freno: 25, n: 26, pct: 96 },
      { name: 'Rampa desoldada / caída', freno: 19, n: 24, pct: 79 },
      { name: 'Guitarra desoldada / quebrada / fisurada', freno: 14, n: 21, pct: 67 },
      { name: 'Piso desoldado / roto', freno: 11, n: 19, pct: 58 },
      { name: 'Matafuego vencido', freno: 9, n: 22, pct: 41 },
      { name: 'Fisura en parabrisa', freno: 12, n: 40, pct: 30 },
      { name: 'Óxido en batea', freno: 8, n: 901, pct: 1 }
    ],
    trend: MESES.map((m, i) => {
      const pct = entre(3, 15);
      return { label: `${m} '${ANIOS[i]}`, n: serieAnual[i].n, freno: Math.round((serieAnual[i].n * pct) / 100), pct };
    })
  };

  // ---------------------------------------------------------- reincidencia
  const watchlist = Array.from({ length: 6 }, () => {
    const abierto = rnd() < 0.4;
    return {
      eq: String(entre(120, 7999)),
      dv: uno(DESVIOS),
      repeats: entre(3, 25),
      ctrlCount: entre(6, 25),
      lastDate: `2026-08-${String(entre(1, 25)).padStart(2, '0')}`,
      estado: abierto ? 'abierto' : 'corregido',
      dots: Array.from({ length: 6 }, (_, i) => ({ ng: i === 5 ? abierto : rnd() < 0.5 }))
    };
  });

  const reincidencia = {
    corregido: 1414, reincidio: 236, sinRecontrol: 206,
    tasa: 14, medianaDias: 13,
    watchTotal: 38,
    watchlist
  };

  // ------------------------------------------------------ trafico y auditores
  const traficoTrend = TRAFICOS.map((name, i) => ({
    name,
    totalN: 947 - i * 180,
    monthly: ['jun', 'jul', 'ago'].map((m) => ({ label: m, n: entre(40, 300), pct: entre(28, 70) }))
  }));

  // Nombres inventados a proposito. El preview se publica en una web abierta y
  // no corresponde poner nombres de gente real al lado de "52% NG, +10 pp vs.
  // el promedio del equipo": eso es la evaluacion de una persona.
  const auditores = [
    { name: 'A. Giménez', n: 896, ng: 468, pct: 52 },
    { name: 'R. Ledesma', n: 692, ng: 292, pct: 42 },
    { name: 'M. Sosa', n: 130, ng: 83, pct: 64 },
    // El apellido repetido sin tilde es el caso real que hay que ver: en el
    // historico la misma persona figura dos veces, escrita distinto, y el
    // tablero la muestra como dos auditores. Ver YI-005.
    { name: 'A. Gimenez', n: 14, ng: 11, pct: 79 }
  ];
  const totalAud = auditores.reduce((a, x) => a + x.n, 0);
  const teamPct = Math.round((auditores.reduce((a, x) => a + x.ng, 0) / totalAud) * 100);

  const hoyFeed = (dayDetail[serieMensual[serieMensual.length - 1].clave] || { rows: [] }).rows;

  window.TABLERO = {
    meta: {
      usuario: { nombre: 'Usuario Demo', email: 'demo@ejemplo.com' },
      // Filas cargadas, no controles: hasta may-2026 una fila es una
      // observacion y desde jun-2026 es un control. Sumarlas como "controles"
      // mezclaba dos cosas distintas.
      //
      // Tiene que ser >= lo del ultimo año, obviamente. Lo estaba fijando a
      // mano y quedaba "4961 en 12 meses / 4268 historicos", que es imposible
      // y se leia en pantalla.
      total: filasAnual + 938,
      updated: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`,
      curMonthLabel: `${MESES[11]} ${hoy.getFullYear()}`,
      priorMonthLabel: MESES[10]
    },
    annual: { series: serieAnual, total: totalAnual, rechazo: retirosAnual, stats: statsAnual },
    monthly: {
      series: serieMensual, stats: statsMensual,
      priorStats: { n: 684, observaciones: 335, ngPct: 49, rechazo: 27, demoraCarga: 12 },
      priorTotal: 684
    },
    monthDetail,
    dayDetail,
    catCounts: cats.map((c) => [c.name, c.n]),
    impacto,
    reincidencia,
    traficoTrend,
    auditorBench: { teamPct, list: auditores },
    pendientes: Array.from({ length: 4 }, () => ({
      eq: String(entre(120, 7999)),
      desvio: uno(DESVIOS),
      date: `2026-08-${String(entre(22, 25)).padStart(2, '0')}`
    })),
    todayFeed: hoyFeed,
    todayCount: hoyFeed.length,
    todayNg: hoyFeed.filter((r) => r.ng).length
  };

  console.log('[preview] tablero de gerencia · datos falsos');
})();
