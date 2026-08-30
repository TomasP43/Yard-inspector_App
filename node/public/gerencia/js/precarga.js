'use strict';

/**
 * Tablero de precarga.
 *
 * Segunda pantalla del tablero de gerencia. Contesta las cuatro preguntas que
 * la planilla no contestaba: **que se daña**, **cuanto se baja fuera del orden
 * solicitado**, **cuanto de lo que se pidio se llego a mirar**, y **que modelos
 * y destinos concentran el daño**.
 *
 * Igual que la pantalla de patrullas, **no calcula ni una metrica**: todo llega
 * agregado del servidor. Aca son miles de unidades con su Pareto de partes y
 * cruces por transportista, modelo y destino; el navegador no es el lugar. Ver
 * `js/datos.js` y YI-014 en REQUERIMIENTOS.md.
 *
 * Se apoya en los globales de `gerencia/js/app.js` (`$`, `esc`, `ico`,
 * `colorPct`, `signo`, `MESES`), que carga antes.
 */
const TableroPrecarga = (() => {

  /** Hasta donde se considera "lo que concentra el problema", igual que patrullas. */
  const UMBRAL = 80;

  /** Los tres grupos de la ficha. Fijos: son las tres partes del auto, no un catalogo. */
  const COLOR_GRUPO = {
    Exterior: 'var(--ttfa-red)',
    Interior: 'var(--status-warn)',
    'Mecánica': 'var(--status-info)'
  };

  let P = null;          // lo que devolvio el servidor
  let corte = 'anual';   // sigue al conmutador de arriba

  const base = () => (corte === 'anual' ? P.annual : P.monthly);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  /**
   * Los cuatro numeros de arriba.
   *
   * La cobertura va con su propio color y al reves que las otras: **bajar es
   * malo**. Es la metrica de vigilancia -- un periodo por debajo de 100% es que
   * se bajaron unidades sin registrarlas, no que se trabajo menos.
   */
  function kpis() {
    const st = base().stats;
    const prev = st.prev || {};

    const delta = (hoy, antes, alReves) => {
      if (antes == null) return { txt: 'sin comparación', color: 'var(--text-faint)' };
      const d = Math.round((hoy - antes) * 10) / 10;
      if (d === 0) return { txt: 'igual que el período anterior', color: 'var(--text-faint)' };
      const peor = alReves ? d < 0 : d > 0;
      return {
        txt: signo(d) + ' pts vs. período anterior',
        color: peor ? 'var(--ttfa-red)' : 'var(--status-ok)'
      };
    };

    const dDano = delta(st.tasa_dano, prev.tasa_dano);
    const dDesvio = delta(st.tasa_desvio, prev.tasa_desvio);
    const dCob = delta(st.cobertura, prev.cobertura, true);

    const filas = [
      { label: 'Unidades bajadas', valor: st.unidades.toLocaleString('es-AR'),
        delta: { txt: `de ${st.solicitadas.toLocaleString('es-AR')} solicitadas`, color: 'var(--text-faint)' },
        pie: 'Registradas con escaneo del VIN' },
      { label: 'Con daño', valor: st.tasa_dano, unidad: '%', tono: 'rojo',
        delta: dDano, pie: `${st.con_dano.toLocaleString('es-AR')} unidades · ${st.danos.toLocaleString('es-AR')} daños` },
      { label: 'Fuera de orden', valor: st.tasa_desvio, unidad: '%', tono: 'ambar',
        delta: dDesvio, pie: `${st.desviadas.toLocaleString('es-AR')} bajadas en otro orden que el solicitado` },
      { label: 'Cobertura', valor: st.cobertura, unidad: '%',
        tono: st.cobertura >= 99 ? 'verde' : st.cobertura >= 90 ? 'ambar' : 'rojo',
        delta: dCob, pie: 'De lo solicitado, cuánto se llegó a registrar' }
    ];

    return `<div class="rejilla-kpi">${filas.map((k) => `
      <div class="kpi ${k.tono || ''}">
        <span class="eq-label">${esc(k.label)}</span>
        <span class="valor"><b>${esc(k.valor)}</b>${k.unidad ? `<span>${esc(k.unidad)}</span>` : ''}</span>
        <span class="delta" style="color:${k.delta.color}">${esc(k.delta.txt)}</span>
        <span class="pie">${esc(k.pie)}</span>
      </div>`).join('')}</div>`;
  }

  /**
   * La evolucion: la barra entera son las unidades bajadas y el rojo la parte
   * con daño.
   *
   * Dos colores y un solo significado, igual que en patrullas: la fraccion roja
   * **es** la tasa. Una linea aparte de tasa sobre un eje distinto obliga a
   * mirar dos cosas para leer una.
   */
  function evolucion() {
    const serie = base().serie || [];
    const max = Math.max(1, ...serie.map((w) => w.unidades));

    return `
      <section class="card">
        <header>
            <span class="eq-label">${corte === 'anual' ? 'Últimos 12 meses' : 'Día por día'}</span>
            <b>Unidades bajadas y con daño</b></header>
        <div class="pcg-evo">
          ${serie.map((w) => {
            const alto = Math.round((w.unidades / max) * 100);
            const rojo = pct(w.con_dano, w.unidades);
            return `
              <div class="pcg-col" title="${esc(w.label)}: ${w.unidades} bajadas, ${w.con_dano} con daño">
                <div class="pcg-barra" style="height:${alto}%">
                  <i style="height:${rojo}%"></i>
                </div>
                <span class="pcg-eje">${esc(w.label)}</span>
              </div>`;
          }).join('')}
        </div>
        <div class="leyenda">
          <span class="ll"><i class="c-ctrl"></i>Unidades bajadas</span>
          <span class="ll"><i class="c-ng"></i>Con al menos un daño</span>
        </div>
      </section>`;
  }

  /** Pareto de partes, con la curva acumulada. Mismo dibujo que el de desvíos. */
  function paretoPartes() {
    const filas = base().pareto_partes || [];
    const dentro = filas.filter((p) => p.cumPct <= UMBRAL).length || filas.length;
    const max = Math.max(1, ...filas.map((p) => p.count));
    const n = filas.length || 1;
    const curva = filas.map((p, i) => `${p.cumPct.toFixed(2)},${(((i + 0.5) / n) * 100).toFixed(2)}`).join(' ');

    return `
      <section class="card">
        <header>
            <span class="eq-label">${dentro} partes explican el ${UMBRAL}% del resto</span>
            <b>Dónde se daña</b></header>
        <div class="pareto">
          <div class="curva">
            <div class="umbral" style="left:${UMBRAL}%"></div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline points="${curva}" fill="none" stroke="var(--status-warn)" stroke-width="1.5"
                        vector-effect="non-scaling-stroke" stroke-linejoin="round"></polyline>
            </svg>
          </div>
          ${filas.map((p) => {
            const on = p.cumPct <= UMBRAL;
            return `
              <div class="f">
                <span class="nom${on ? ' dentro' : ''}">${esc(p.name)}</span>
                <span class="pista"><i class="${on ? 'dentro' : ''}" style="width:${Math.round((p.count / max) * 100)}%"></i></span>
                <span class="n">${p.count}</span>
                <span class="acum${on ? ' dentro' : ''}">${p.cumPct}%</span>
              </div>`;
          }).join('')}
        </div>
        <div class="leyenda">
          <span class="ll"><i class="c-ng"></i>Dentro del ${UMBRAL}%</span>
          <span class="ll"><i class="linea"></i>Curva acumulada · línea punteada = ${UMBRAL}%</span>
        </div>
      </section>`;
  }

  /** Qué tipo de daño, y en qué parte del auto. */
  function tiposYGrupo() {
    const tipos = base().pareto_tipos || [];
    const grupos = base().por_grupo || [];
    const maxT = Math.max(1, ...tipos.map((t) => t.count));

    return `
      <div class="rejilla-2">
        <section class="card">
          <header><span class="eq-label">Sobre el total de daños</span><b>Qué tipo de daño</b></header>
          <div class="barras-h">
            ${tipos.map((t) => `
              <div class="f">
                <div class="cab"><span>${esc(t.name)}</span><b>${t.count} · ${t.pct}%</b></div>
                <div class="pista"><i style="width:${Math.round((t.count / maxT) * 100)}%;background:var(--ttfa-red)"></i></div>
              </div>`).join('')}
          </div>
        </section>

        <section class="card">
          <header><span class="eq-label">Reparto por parte del auto</span><b>Exterior, interior o mecánica</b></header>
          <div class="rejilla-3 bordeada">
            ${grupos.map((g) => `
              <div>
                <span class="eq-label">${esc(g.name)}</span>
                <b style="color:${COLOR_GRUPO[g.name] || 'var(--text-strong)'}">${g.pct}<small>%</small></b>
                <small>${g.count} ${g.count === 1 ? 'daño' : 'daños'}</small>
              </div>`).join('')}
          </div>
          <p class="nota">Van los tres números y no una cinta: el exterior se lleva más del 95% —es lo que se golpea al maniobrar— y una banda de un solo color no informa nada. Interior y mecánica son pocos casos, pero son los caros.</p>
        </section>
      </div>`;
  }

  /**
   * Desvios de orden, por transportista y por bahia.
   *
   * **Cada barra tiene su propio denominador**: son las unidades que movio esa
   * empresa, no el total. Sin eso, la que mas mueve encabeza siempre por mover
   * mas y no por bajar peor -- que es el mismo error que ya se corrigio en la
   * tarjeta de transportistas de patrullas.
   */
  function desviosOrden() {
    const d = base().desvios || {};
    const bloque = (titulo, eyebrow, lista, nota) => {
      const peor = Math.max(1, ...(lista || []).map((x) => x.pct));
      return `
        <section class="card">
          <header><span class="eq-label">${esc(eyebrow)}</span><b>${esc(titulo)}</b></header>
          <div class="barras-h">
            ${(lista || []).slice().sort((a, b) => b.pct - a.pct).map((x) => `
              <div class="f">
                <div class="cab">
                  <span>${esc(x.name)}<small>${x.unidades} unidades</small></span>
                  <b>${x.desviadas} · ${x.pct}%</b>
                </div>
                <div class="pista"><i style="width:${Math.round((x.pct / peor) * 100)}%;background:var(--status-warn)"></i></div>
              </div>`).join('')}
          </div>
          <p class="nota">${esc(nota)}</p>
        </section>`;
    };

    return `
      <div class="rejilla-2">
        ${bloque('Fuera de orden por transportista', 'Sobre las unidades que movió cada una', d.por_transportista,
          'La barra es el porcentaje propio, no el volumen: si no, la que más mueve encabeza siempre.')}
        ${bloque('Fuera de orden por bahía', 'Sobre las unidades bajadas en cada bahía', d.por_bahia,
          'Una bahía que se repite no es un problema del transportista: es cómo está armada la playa ahí.')}
      </div>`;
  }

  /** Cobertura: lo solicitado contra lo que se llegó a registrar. */
  function cobertura() {
    const serie = base().serie || [];
    const max = Math.max(1, ...serie.map((w) => w.solicitadas));

    return `
      <section class="card">
        <header>
            <span class="eq-label">Solicitado contra registrado</span>
            <b>Qué nos falta mirar</b></header>
        <div class="barras-h">
          ${serie.map((w) => {
            const c = pct(w.unidades, w.solicitadas);
            return `
              <div class="f">
                <div class="cab">
                  <span>${esc(w.label)}<small>${w.unidades} de ${w.solicitadas}</small></span>
                  <b style="color:${c >= 99 ? 'var(--status-ok)' : c >= 90 ? 'var(--status-warn)' : 'var(--ttfa-red)'}">${c}%</b>
                </div>
                <div class="pista">
                  <i style="width:${Math.round((w.solicitadas / max) * 100)}%;background:var(--graphite-600)"></i>
                  <i class="pcg-encima" style="width:${Math.round((w.unidades / max) * 100)}%;background:var(--status-ok)"></i>
                </div>
              </div>`;
          }).join('')}
        </div>
        <p class="nota">Cada barra es lo solicitado; la parte verde es lo que se registró. Un período por debajo del 100% es que se bajaron unidades sin escanear, no que se movió menos.</p>
      </section>`;
  }

  /** Daño por modelo y por destino. */
  function modeloYDestino() {
    const bloque = (titulo, eyebrow, lista, nota) => {
      const peor = Math.max(1, ...(lista || []).map((x) => x.pct));
      return `
        <section class="card">
          <header><span class="eq-label">${esc(eyebrow)}</span><b>${esc(titulo)}</b></header>
          <div class="barras-h">
            ${(lista || []).slice().sort((a, b) => b.pct - a.pct).map((x) => `
              <div class="f">
                <div class="cab">
                  <span>${esc(x.name)}<small>${x.unidades} unidades</small></span>
                  <b>${x.con_dano} · ${x.pct}%</b>
                </div>
                <div class="pista"><i style="width:${Math.round((x.pct / peor) * 100)}%;background:var(--ttfa-red)"></i></div>
              </div>`).join('')}
          </div>
          <p class="nota">${esc(nota)}</p>
        </section>`;
    };

    return `
      <div class="rejilla-2">
        ${bloque('Daño por modelo', 'Unidades con daño sobre las bajadas de ese modelo', base().por_modelo,
          'Un modelo que se despega del resto es una conversación con el origen, no con la playa.')}
        ${bloque('Daño por destino', 'Unidades con daño sobre las bajadas a ese destino', base().por_destino,
          'Sirve para llegar a la reunión con el cliente sabiendo el número antes que él.')}
      </div>`;
  }

  function pintar() {
    if (!P) return;
    $('#contenido-precarga').innerHTML =
      kpis() + evolucion() + paretoPartes() + tiposYGrupo() + desviosOrden() + cobertura() + modeloYDestino();
  }

  /** Las filas que se bajan con el boton de exportar, cuando esta pantalla es la abierta. */
  function filasCsv() {
    if (!P) return null;
    return [
      ['Parte', 'Daños', '% acumulado'],
      ...(base().pareto_partes || []).map((p) => [p.name, p.count, p.cumPct])
    ];
  }

  async function cargar(nuevoCorte) {
    corte = nuevoCorte;
    P = await Datos.traerPrecarga(corte);
    pintar();
  }

  return { cargar, pintar, filasCsv, get datos() { return P; } };
})();
