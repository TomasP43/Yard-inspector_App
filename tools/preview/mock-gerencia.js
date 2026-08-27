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

  const TRAFICOS = ['Brasil', 'Autoport', 'Chile', 'Paraguay', 'Bolivia'];
  const DESVIOS = [
    // Dos que ya no existen: 'Óxido avanzado en batea' se fusiono con 'Óxido en
    // batea', y 'Óxido y suciedad en batea' se partio en sus dos partes -- el
    // campo es multivalor, asi que la combinacion se carga marcando las dos.
    'Óxido en batea', 'Suciedad en batea',
    'Fisura en parabrisa', 'Lona en mal estado',
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
  //   volumen  camiones movidos POR LA PLAYA. Se sabe siempre, sale de
  //            operaciones. **No es el total de la tabla**: el flujo
  //            Puerto/Cruce queda afuera porque no entra a la playa y no se
  //            patrulla -- es el 66% del volumen con 11 controles en tres
  //            meses. Sacandolo, jul-2026 da 99% de cobertura; con el adentro,
  //            32%. Ver YI-004.
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
    // Desde el corte se controla TODO lo que se mueve: `n === volumen`. Antes
    // la patrulla tomaba una parte, y en los meses viejos ni siquiera se sabe
    // cual. Los dos campos siguen existiendo por separado a proposito: la
    // cobertura deja de ser una salvedad del dato historico y pasa a ser algo
    // que hay que vigilar -- si un mes baja de 100%, se dejo de controlar algo.
    const n = conControles ? volumen : null;
    const ng = conControles ? Math.round((volumen * entre(38, 60)) / 100) : entre(80, 340);
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

  /**
   * Pareto **sin el oxido**.
   *
   * El oxido solo es el 55% de los desvios: con el adentro, el Pareto contesta
   * siempre lo mismo -- "el problema es el oxido" -- y tapa los otros diez, que
   * son sobre los que se puede hacer algo distinto. Sale de la lista y su peso
   * se dice aparte, que es el unico dato que ese renglon aportaba.
   *
   * `cumPct` se acumula sobre el total SIN oxido: es el porcentaje de lo que la
   * tabla muestra. Acumular sobre el total con oxido dejaria la curva sin poder
   * llegar nunca al 100%.
   */
  const APARTE = 'Óxido en batea';

  function pareto(cuantos) {
    const base = DESVIOS.slice(0, cuantos).map((name, i) => ({
      name, count: Math.round(900 / Math.pow(1.55, i)) + entre(-8, 8)
    })).filter((p) => p.count > 0);

    const todo = base.reduce((a, p) => a + p.count, 0) || 1;
    const oxido = base.find((p) => p.name === APARTE);
    const resto = base.filter((p) => p.name !== APARTE);

    const total = resto.reduce((a, p) => a + p.count, 0) || 1;
    let acum = 0;
    const items = resto.map((p) => {
      acum += p.count;
      return { ...p, cumPct: Math.round((acum / total) * 100) };
    });

    return {
      items,
      aparte: oxido
        ? { name: oxido.name, count: oxido.count, pct: Math.round((oxido.count / todo) * 100) }
        : null
    };
  }

  const statsAnual = {
    n: totalAnual,
    mesesConControles: conControlesAnual.length,
    observaciones: obsAnual,
    volumen: volumenAnual,
    obsPct: Math.round((obsAnual / volumenAnual) * 1000) / 10,
    retiroProm: marcarZ(serieAnual),

    // El embudo de los KPIs: base -> NG -> retiros y demoras. Las cuatro cifras
    // salen de los mismos meses y se dividen por la misma base.
    //
    // En la ventana de doce meses la base son los **camiones movidos**, que es
    // lo unico que se conoce de punta a punta: `n` va null porque no existe un
    // total de controles del periodo -- solo algunos meses los tienen.
    // Cuantos meses tienen control cargado sale de `mesesConControles`, que la
    // pantalla usa para decirlo en meses y no en porcentaje: un "18% del
    // periodo fue controlado" se leia como que se controla poco, cuando lo que
    // pasa es que diez de los doce meses no tienen el dato.
    embudo: {
      n: null,
      volumen: volumenAnual,
      ng: obsAnual,
      rechazo: retirosAnual,
      demora: serieAnual.reduce((a, m) => a + m.demora, 0)
    },
    ngPct: Math.round((conControlesAnual.reduce((a, m) => a + m.ng, 0) / totalAnual) * 100),
    okPct: null,
    rechazo: retirosAnual, demoraCarga: 75,
    ...(() => { const p = pareto(12); return { pareto: p.items, paretoAparte: p.aparte }; })()
  };
  statsAnual.okPct = 100 - statsAnual.ngPct;

  // ----------------------------------------------------------- serie mensual
  const hoy = new Date();
  const diasMes = hoy.getDate();
  const serieMensual = Array.from({ length: diasMes }, (_, i) => {
    const dia = i + 1;
    // Un par de dias sin patrulla: los fines de semana existen.
    const sin = dia % 7 === 0 || dia % 7 === 6;
    // El mes en curso es posterior al corte: se controla todo lo que se mueve,
    // asi que `n === volumen` y nunca es null. Un dia sin patrulla es n=0, que
    // es otra cosa -- no se controlo nada, no es que no se sepa cuanto.
    const volumen = sin ? 0 : entre(60, 130);
    const n = volumen;
    const ngPct = n ? entre(38, 60) : null;
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
    // El mes en curso es posterior al corte: todos los dias tienen control y
    // `n === volumen`, asi que la base son los controlados.
    embudo: {
      n: totalMes,
      ng: serieMensual.reduce((a, d) => a + (d.ng || 0), 0),
      rechazo: retirosMes,
      demora: serieMensual.reduce((a, d) => a + d.demora, 0),
      volumen: serieMensual.reduce((a, d) => a + d.volumen, 0)
    },
    ngPct: 44, okPct: 56,
    rechazo: retirosMes, demoraCarga: 9,
    ...(() => { const p = pareto(9); return { pareto: p.items, paretoAparte: p.aparte }; })()
  };

  // -------------------------------------------------------------- detalles
  const monthDetail = {};
  serieAnual.forEach((m) => {
    monthDetail[m.clave] = {
      label: m.label, volumen: m.volumen, n: m.n, ng: m.ng, rechazo: m.rechazo,
      demora: m.demora,
      topDesvios: DESVIOS.slice(0, 5).map((name, i) => ({ name, count: entre(6, 90 - i * 12) })),
      topEquipos: Array.from({ length: 5 }, () => ({ name: String(entre(120, 7999)), count: entre(2, 9) })),
      // Uno por retiro, no un largo al azar. Estaba con `entre(0, 6)` contra un
      // `rechazo` de 4 a 42, asi que el KPI decia "37 retiros" y la lista de
      // abajo "Ningun retiro este mes" en la misma pantalla.
      rechazoList: Array.from({ length: m.rechazo }, () => ({
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
          ng,
          desvio: ng ? uno(DESVIOS) : ''
        };
      }).sort((a, b) => a.time.localeCompare(b.time))
    };
  });

  // --------------------------------------------------------------- impacto
  // Se fue el desglose por tipo de control (YI-008). Quedan los totales del
  // desenlace y el top por desvio, que es el que dice cual frena.
  const impTotal = 3324;

  const impacto = {
    total: impTotal,
    outcome: [
      { key: 'Cargo', n: 2932 },
      { key: 'Demora en carga', n: 89 },
      { key: 'Se retira', n: 303 }
    ],
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
  // La reincidencia tambien va sin oxido, por lo mismo que el Pareto: es la
  // mitad de los desvios y se repite en casi todos los equipos, asi que con el
  // adentro la watchlist es una lista de oxido y no se ve nada mas. La tasa y
  // la cinta de la izquierda se calculan sobre el mismo universo -- si la lista
  // excluyera y el porcentaje no, serian dos cosas distintas en una tarjeta.
  const SIN_OXIDO = DESVIOS.filter((d) => d !== APARTE);

  const watchlist = Array.from({ length: 6 }, () => {
    const abierto = rnd() < 0.4;
    return {
      eq: String(entre(120, 7999)),
      dv: uno(SIN_OXIDO),
      repeats: entre(3, 25),
      ctrlCount: entre(6, 25),
      lastDate: `2026-08-${String(entre(1, 25)).padStart(2, '0')}`,
      estado: abierto ? 'abierto' : 'corregido',
      dots: Array.from({ length: 6 }, (_, i) => ({ ng: i === 5 ? abierto : rnd() < 0.5 }))
    };
  });

  // Numeros mas chicos que antes a proposito: sin el oxido, el universo de
  // desvios con desenlace registrado se reduce a poco mas de la mitad.
  const reincidencia = {
    excluye: APARTE,
    // El oxido sale de la tarjeta, pero no desaparece: cuantos equipos lo
    // tienen abierto ahora mismo va arriba a la derecha. Es el unico dato que
    // esas filas aportaban y el que de verdad se puede accionar.
    oxidoActivo: { equipos: 57, deTotal: 214 },
    corregido: 786, reincidio: 121, sinRecontrol: 98,
    tasa: 12, medianaDias: 15,
    watchTotal: 21,
    watchlist
  };

  // ------------------------------------------------------ trafico y auditores
  const traficoTrend = TRAFICOS.map((name, i) => ({
    name,
    totalN: 947 - i * 180,
    monthly: ['jun', 'jul', 'ago'].map((m) => ({ label: m, n: entre(40, 300), pct: entre(28, 70) }))
  }));

  /**
   * Tasa de NG por empresa transportista.
   *
   * NG sobre camiones movidos de esa empresa, no sobre el total: la pregunta es
   * cual anda peor, no cual mueve mas. Sin dividir por el volumen propio, la
   * empresa mas grande encabeza siempre por ser la mas grande.
   *
   * **Volumenes inventados**, como todo este archivo. Cuantos camiones mueve
   * cada transportista es informacion comercial y el preview se publica abierto;
   * lo real viaja por el contrato. Los nombres si son los que usa la operacion.
   */
  const empresas = [
    { name: 'Furlong', volumen: 9800 },
    { name: 'TTFA', volumen: 5100 },
    { name: 'Autoport', volumen: 2300 },
    { name: 'CAT', volumen: 1100 },
    { name: 'Green Mile', volumen: 380 }
  ].map((e) => {
    const ng = Math.round((e.volumen * entre(8, 34)) / 100);
    // Cada empresa trae su propio Pareto: al tocarla, la tarjeta de al lado
    // pasa a ser la de ella.
    const p = pareto(entre(7, 12));
    return {
      ...e, ng, pct: Math.round((ng / e.volumen) * 1000) / 10,
      pareto: p.items, paretoAparte: p.aparte
    };
  }).sort((a, b) => b.pct - a.pct);

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
    impacto,
    reincidencia,
    traficoTrend,
    empresas,
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
