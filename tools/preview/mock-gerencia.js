'use strict';

/**
 * Datos falsos del tablero de gerencia.
 *
 * Define `window.TABLERO` con **la forma exacta que tiene que devolver
 * `GET api/tablero`** (ver YI-004 en REQUERIMIENTOS.md). Si el contrato cambia,
 * esto tiene que cambiar con el o el preview empieza a mentir.
 *
 * Los ordenes de magnitud salen del historico real: ~4.200 controles en 12
 * meses, tasa NG cerca del 50%, y el dato incomodo de que **antes de junio de
 * 2026 no se distinguia OK de NG**. Esos meses van con `ngPct: null`, que no es
 * lo mismo que cero, y la pantalla tiene que mostrarlo como "sin tracking".
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
  // Los tres ultimos meses son los unicos con OK/NG; antes va null.
  const serieAnual = MESES.map((m, i) => {
    const n = entre(80, 690);
    const conTracking = i >= 9;
    const ngPct = conTracking ? entre(42, 62) : null;
    const rechazo = entre(4, 42);
    return {
      label: `${m} '${ANIOS[i]}`,
      clave: `20${ANIOS[i]}-${NUM[i]}`,
      n,
      ng: ngPct == null ? null : Math.round((n * ngPct) / 100),
      ngPct,
      rechazo,
      rechazoPct: Math.round((rechazo / n) * 1000) / 10
    };
  });

  const totalAnual = serieAnual.reduce((a, m) => a + m.n, 0);
  const retirosAnual = serieAnual.reduce((a, m) => a + m.rechazo, 0);

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
    n: totalAnual, ngTracked: true, ngPct: 49, okPct: 51,
    rechazo: retirosAnual, demoraCarga: 75, criticoPct: 12,
    pareto: pareto(12)
  };

  // ----------------------------------------------------------- serie mensual
  const hoy = new Date();
  const diasMes = hoy.getDate();
  const serieMensual = Array.from({ length: diasMes }, (_, i) => {
    const dia = i + 1;
    // Un par de dias sin patrulla: los fines de semana existen.
    const sin = dia % 7 === 0 || dia % 7 === 6;
    const n = sin ? 0 : entre(14, 42);
    const ngPct = n ? entre(38, 60) : null;
    return {
      label: String(dia).padStart(2, '0'),
      clave: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
      n,
      ng: n ? Math.round((n * ngPct) / 100) : null,
      ngPct,
      rechazo: n ? entre(0, 3) : 0,
      rechazoPct: n ? entre(0, 12) : 0
    };
  });

  const totalMes = serieMensual.reduce((a, d) => a + d.n, 0);
  const retirosMes = serieMensual.reduce((a, d) => a + d.rechazo, 0);
  const statsMensual = {
    n: totalMes, ngTracked: true, ngPct: 44, okPct: 56,
    rechazo: retirosMes, demoraCarga: 9, criticoPct: 14,
    pareto: pareto(9)
  };

  // -------------------------------------------------------------- detalles
  const monthDetail = {};
  serieAnual.forEach((m) => {
    monthDetail[m.clave] = {
      label: m.label, n: m.n, ng: m.ng ?? m.n, rechazo: m.rechazo,
      ngTracked: m.ngPct != null,
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
      label: `${d.label} ${MESES[11]}`, n: d.n, ng: d.ng, rechazo: d.rechazo,
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

  const auditores = [
    { name: 'L. Pintos', n: 896, ng: 468, pct: 52 },
    { name: 'Almirón', n: 692, ng: 292, pct: 42 },
    { name: 'M. Camejo', n: 130, ng: 83, pct: 64 },
    // A proposito: en el historico real "Almiron" sin tilde figura como una
    // persona distinta de "Almirón". Es la misma. Que se vea en el preview.
    { name: 'Almiron', n: 14, ng: 11, pct: 79 }
  ];
  const totalAud = auditores.reduce((a, x) => a + x.n, 0);
  const teamPct = Math.round((auditores.reduce((a, x) => a + x.ng, 0) / totalAud) * 100);

  const hoyFeed = (dayDetail[serieMensual[serieMensual.length - 1].clave] || { rows: [] }).rows;

  window.TABLERO = {
    meta: {
      total: 4268,
      updated: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`,
      curMonthLabel: `${MESES[11]} ${hoy.getFullYear()}`,
      priorMonthLabel: MESES[10]
    },
    annual: { series: serieAnual, total: totalAnual, rechazo: retirosAnual, stats: statsAnual },
    monthly: {
      series: serieMensual, stats: statsMensual,
      priorStats: { n: 684, ngPct: 49, rechazo: 27, demoraCarga: 12 },
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
