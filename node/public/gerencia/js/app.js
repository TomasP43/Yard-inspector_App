'use strict';

/**
 * Tablero de gerencia — Patrulla de calidad.
 *
 * Portado del diseño "Dashboard Gerencia" del proyecto de Claude Design. Los
 * colores y la disposicion son los de ahi; lo que no se porta es el mecanismo
 * (iconos inline en vez de CDN, tokens copiados) por las mismas razones que en
 * la PWA: sin conexion no llegan y un dominio de afuera no pasa la politica de
 * la intranet.
 *
 * **Todo lo que se muestra llega ya agregado desde el servidor.** Aca no se
 * calcula ninguna metrica: solo se dibuja. Ver js/datos.js y REQUERIMIENTOS.md.
 */

const $ = (s, r = document) => r.querySelector(s);
const ico = (n, s) => Iconos.svg(n, s);

const COLOR_TIPO = {
  '5s': 'var(--ttfa-red)',
  'Mantenimiento': 'var(--status-warn)',
  'Seguridad': 'var(--status-info)',
  'Calidad': 'var(--status-ok)'
};

const MESES = { '01': 'ene', '02': 'feb', '03': 'mar', '04': 'abr', '05': 'may', '06': 'jun',
                '07': 'jul', '08': 'ago', '09': 'sep', '10': 'oct', '11': 'nov', '12': 'dic' };

/** Umbral del Pareto: hasta donde se considera "lo que concentra el problema". */
const UMBRAL_PARETO = 80;

let D = null;                 // el tablero que devolvio el servidor
let periodo = 'anual';
let elegido = null;           // clave del mes o del dia abierto en el detalle

// ------------------------------------------------------------------ utilidades

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtFecha = (iso) => (iso ? iso.slice(8) + ' ' + MESES[iso.slice(5, 7)] : '—');

/**
 * Color de una tasa de NG. Los cortes salen del diseño y son de negocio, no
 * esteticos: arriba de 55% es rojo porque mas de la mitad de los controles con
 * observacion deja de ser una excepcion.
 */
const colorPct = (v) =>
  v == null ? 'var(--text-faint)'
  : v >= 55 ? 'var(--ttfa-red)'
  : v >= 40 ? 'var(--status-warn)'
  : 'var(--status-ok)';

const signo = (n) => (n >= 0 ? '+' : '') + n;

/** Iniciales para el avatar, mismo criterio que la PWA ("TP"). */
function iniciales(u) {
  if (!u) return '';
  const n = (u.nombre || '').trim();
  if (n) {
    const p = n.split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  return (u.email || '').split('@')[0].slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------- tema

function aplicarTema(claro) {
  const raiz = document.documentElement;
  if (claro) raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');
  $('#tema').innerHTML = ico(claro ? 'moon' : 'sun', 15);
  $('#tema').setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', claro ? '#ffffff' : '#101113');
  try { localStorage.setItem('yard-tema', claro ? 'claro' : 'oscuro'); } catch (e) { /* modo privado */ }
}

// --------------------------------------------------------------- estructura

function pintarLateral() {
  // Un solo item: el tablero es la unica pantalla que hay de este lado.
  //
  // El diseño trae ademas "Patrulla de hoy", "Historial completo" y "Equipos",
  // pero apuntaban a `../#hoy` y compañia -- y la PWA no lee el hash, asi que
  // los tres caian en la misma pantalla por defecto. "Equipos" ni siquiera
  // existe como vista. Un menu que promete cuatro lugares y lleva a uno es peor
  // que un menu de uno.
  $('#menu').innerHTML =
    `<span class="it activo">${ico('gauge', 16)}<span>Tablero gerencia</span></span>`;

  // Quien esta mirando. Viene con el tablero: es el mismo usuario de la sesion
  // de ttfa, no se elige.
  const u = (D && D.meta && D.meta.usuario) || null;
  $('#usuario').textContent = u ? (u.email || u.nombre || '') : '';
  $('#avatar').textContent = u ? iniciales(u) : '';

  $('#exportar').innerHTML = ico('download', 16);
  $('#cerrar-detalle').innerHTML = ico('x', 14);
}

function pintarPeriodo() {
  $('#periodo').innerHTML = [['anual', 'Anual'], ['mensual', 'Mensual']]
    .map(([k, t]) => `<button type="button" data-p="${k}" class="${periodo === k ? 'sel' : ''}">${t}</button>`)
    .join('');
}

// ------------------------------------------------------------------- KPIs

function pintarKpis() {
  const anual = periodo === 'anual';
  const st = (anual ? D.annual : D.monthly).stats;
  const prev = (D.monthly && D.monthly.priorStats) || {};
  const mesPrev = D.meta.priorMonthLabel;

  const retiroPct = st.n ? Math.round((st.rechazo / st.n) * 1000) / 10 : 0;
  const dRetiro = anual ? null : st.rechazo - (prev.rechazo || 0);
  const dNg = anual || st.ngPct == null || prev.ngPct == null ? null : st.ngPct - prev.ngPct;
  const dDemora = anual ? null : st.demoraCarga - (prev.demoraCarga || 0);

  const kpis = [
    {
      label: 'Controles realizados', valor: st.n, unidad: '', tono: '',
      delta: anual ? 'últimos 12 meses' : `${signo(st.n - D.monthly.priorTotal)} vs. ${mesPrev}`,
      deltaColor: 'var(--text-muted)',
      pie: anual ? `${D.meta.total} históricos` : 'mes en curso'
    },
    {
      // El NG solo existe desde que se empezo a distinguir OK de NG. Antes de
      // eso el dato no es cero: no existe, y se dice.
      label: 'Con observación', valor: st.ngPct == null ? '—' : st.ngPct, unidad: '%',
      color: colorPct(st.ngPct),
      delta: dNg == null
        ? (st.okPct == null ? 'sin tracking' : `${st.okPct}% pasaron OK`)
        : `${signo(dNg)} pp vs. ${mesPrev}`,
      deltaColor: dNg != null && dNg > 0 ? 'var(--ttfa-red)' : 'var(--status-ok)',
      pie: anual ? 'meses con tracking' : `${st.okPct}% OK`
    },
    {
      label: 'Unidades retiradas', valor: st.rechazo, unidad: '', tono: 'rojo',
      delta: `${retiroPct}% del total auditado`,
      deltaColor: dRetiro != null && dRetiro > 0 ? 'var(--ttfa-red)' : 'var(--text-muted)',
      pie: dRetiro == null ? 'últimos 12 meses' : `${signo(dRetiro)} vs. ${mesPrev}`
    },
    {
      label: 'Demora de carga', valor: st.demoraCarga, unidad: 'casos', tono: 'ambar',
      delta: anual ? 'últimos 12 meses' : `${signo(dDemora)} vs. ${mesPrev}`,
      deltaColor: 'var(--text-muted)',
      pie: `${st.criticoPct}% de los NG son de seguridad`
    }
  ];

  $('#kpis').innerHTML = kpis.map((k) => `
    <div class="kpi ${k.tono || ''}">
      <span class="eq-label">${esc(k.label)}</span>
      <span class="valor">
        <b${k.color ? ` style="color:${k.color}"` : ''}>${esc(k.valor)}</b>
        ${k.unidad ? `<span>${esc(k.unidad)}</span>` : ''}
      </span>
      <span class="delta" style="color:${k.deltaColor}">${esc(k.delta)}</span>
      <span class="pie">${esc(k.pie)}</span>
    </div>`).join('');
}

// -------------------------------------------------------------- evolución

const ALTO_BARRA = 176;

function pintarEvolucion() {
  const anual = periodo === 'anual';
  const src = anual ? D.annual : D.monthly;
  const serie = src.series || [];
  const claves = Object.keys((anual ? D.monthDetail : D.dayDetail) || {});

  $('#evo-eyebrow').textContent = anual
    ? 'Controles por mes · últimos 12 meses'
    : `Controles por día · ${D.meta.curMonthLabel}`;
  $('#evo-titulo').textContent = anual ? 'Evolución del año' : 'Evolución del mes';
  $('#evo-pista').textContent = anual ? 'Tocá un mes para abrir el detalle' : 'Tocá un día para abrir el detalle';

  // Escala redondeada a multiplos de 50: un eje con "437" arriba no se lee.
  const crudo = Math.max(1, ...serie.map((w) => w.n));
  const paso = Math.max(1, Math.ceil(crudo / 4 / 50) * 50);
  const tope = paso * 4;

  $('#evo-eje').innerHTML = [0, 1, 2, 3, 4].map((i) =>
    `<span style="bottom:${Math.round(6 + (ALTO_BARRA * i) / 4)}px">${paso * i || 0}</span>`).join('');

  const maxRet = Math.max(1, ...serie.map((w) => w.rechazo || 0));
  const n = serie.length || 1;
  const puntos = serie.map((w, i) =>
    `${(((i + 0.5) / n) * 100).toFixed(2)},${(100 - ((w.rechazo || 0) / maxRet) * 92).toFixed(2)}`).join(' ');

  const guias = [0, 1, 2, 3, 4].map((i) =>
    `<div class="guia" style="bottom:${Math.round(6 + (ALTO_BARRA * i) / 4)}px"></div>`).join('');

  const dots = serie.map((w, i) =>
    `<i style="left:${(((i + 0.5) / n) * 100).toFixed(2)}%;bottom:${(((w.rechazo || 0) / maxRet) * 92).toFixed(2)}%"></i>`).join('');

  const cols = serie.map((w, i) => {
    const k = claves[i];
    const sel = k && k === elegido;
    const alto = Math.round((w.n / tope) * ALTO_BARRA) + 2;
    const altoNg = w.ng == null ? 0 : Math.round((w.ng / tope) * ALTO_BARRA);
    return `
      <button type="button" class="col${sel ? ' sel' : ''}" data-k="${esc(k || '')}">
        <small style="color:${sel ? 'var(--text-strong)' : colorPct(w.ngPct)};font-weight:${sel ? '600' : '400'}">
          ${w.ngPct == null ? '—' : w.ngPct + '%'}
        </small>
        <span class="barra" style="height:${alto}px"><i style="height:${altoNg}px"></i></span>
      </button>`;
  }).join('');

  $('#evo-plot').innerHTML = `
    ${guias}
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline points="${puntos}" fill="none" stroke="var(--status-warn)" stroke-width="1.5"
                vector-effect="non-scaling-stroke" stroke-linejoin="round"></polyline>
    </svg>
    <div class="puntos">${dots}</div>
    <div class="cols">${cols}</div>`;

  $('#evo-pie').innerHTML = serie.map((w, i) => {
    const k = claves[i];
    const sel = k && k === elegido;
    const color = sel ? 'var(--ttfa-red)' : (i === serie.length - 1 ? 'var(--text-strong)' : 'var(--text-faint)');
    const cRet = (w.rechazoPct || 0) >= 8 ? 'var(--status-warn)' : 'var(--text-faint)';
    return `
      <button type="button" data-k="${esc(k || '')}">
        <span style="color:${color}">${esc(w.label)}</span>
        <span style="color:${cRet}">${w.rechazo ? w.rechazo + ' ret.' : '0'}</span>
      </button>`;
  }).join('');
}

// ---------------------------------------------------------------- detalle

function pintarDetalle() {
  const caja = $('#detalle');
  const anual = periodo === 'anual';
  const fuente = (anual ? D.monthDetail : D.dayDetail) || {};
  const d = elegido ? fuente[elegido] : null;

  if (!d) { caja.hidden = true; return; }
  caja.hidden = false;

  $('#detalle-titulo').textContent = d.label || elegido;

  const pct = (v) => (d.n ? Math.round((v / d.n) * 100) : 0);
  $('#detalle-kpis').innerHTML = `
    <div><span class="eq-label">Controles</span><b>${d.n}</b></div>
    <div>
      <span class="eq-label">Con observación</span>
      <b class="ambar">${d.ngTracked === false ? '—' : d.ng}</b>
      <small>${d.ngTracked === false ? 'sin tracking ese mes' : pct(d.ng) + '% del total'}</small>
    </div>
    <div>
      <span class="eq-label">Retiros</span>
      <b class="rojo">${d.rechazo}</b>
      <small>${pct(d.rechazo)}% del total</small>
    </div>`;

  $('#detalle-cuerpo').innerHTML = anual ? detalleMes(d) : detalleDia(d);
}

function detalleMes(d) {
  const lista = (arr, mono) => (arr || []).map((x) => `
    <div class="f">
      <span${mono ? ' class="mono-eq"' : ''}>${esc(x.name)}</span>
      <b>${esc(x.count)}</b>
    </div>`).join('') || '<p class="nota">Sin datos.</p>';

  return `
    <div class="detalle-3">
      <div>
        <span class="eq-label">Top desvíos</span>
        <div class="lista">${lista(d.topDesvios)}</div>
      </div>
      <div>
        <span class="eq-label">Equipos con más NG</span>
        <div class="lista">${lista(d.topEquipos, true)}</div>
      </div>
      <div>
        <span class="eq-label">Retiros del mes</span>
        <div class="lista detalle-scroll">
          ${(d.rechazoList || []).map((r) => `
            <div class="f" style="border-bottom:1px solid var(--line-hairline);padding:7px 0">
              <span class="mono" style="width:44px;flex:0 0 44px;font-size:11px;color:var(--text-faint)">${esc(r.dayLabel || fmtFecha(r.date))}</span>
              <span class="mono-eq" style="width:48px;flex:0 0 48px">${esc(r.eq)}</span>
              <span style="flex:1;min-width:0;font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.desvio)}</span>
            </div>`).join('') || '<p class="nota">Ningún retiro este mes.</p>'}
        </div>
      </div>
    </div>`;
}

function detalleDia(d) {
  return `
    <span class="eq-label">Controles del día</span>
    <div class="lista-fina detalle-dia">
      ${(d.rows || []).map((r) => `
        <div class="f">
          <span class="hora">${esc(r.time)}</span>
          <span class="eq">${esc(r.eq)}</span>
          <span class="badge sin-punto ${r.ng ? (r.cat === 'Seguridad' ? 'risk' : 'warn') : 'ok'}">${esc(r.ng ? (r.cat || 'NG') : 'OK')}</span>
          <span class="dv">${esc(r.desvio || 'Sin desvíos')}</span>
          <span class="der">${esc(r.trafico || '')}</span>
        </div>`).join('') || '<p class="nota">Sin controles ese día.</p>'}
    </div>`;
}

// ----------------------------------------------------------------- pareto

function pintarPareto() {
  const st = (periodo === 'anual' ? D.annual : D.monthly).stats;
  const filas = st.pareto || [];

  const dentro = filas.filter((p) => p.cumPct <= UMBRAL_PARETO).length || filas.length;
  $('#pareto-eyebrow').textContent = `${dentro} desvíos explican el ${UMBRAL_PARETO}% de las observaciones`;
  $('#pareto-titulo').textContent = 'Desvíos que concentran el problema';
  $('#pareto-ll-1').textContent = `Dentro del ${UMBRAL_PARETO}%`;
  $('#pareto-ll-2').textContent = `Curva acumulada · línea punteada = ${UMBRAL_PARETO}%`;

  const max = Math.max(1, ...filas.map((p) => p.count));
  const n = filas.length || 1;
  const curva = filas.map((p, i) =>
    `${p.cumPct.toFixed(2)},${(((i + 0.5) / n) * 100).toFixed(2)}`).join(' ');

  $('#pareto').innerHTML = `
    <div class="curva">
      <div class="umbral" style="left:${UMBRAL_PARETO}%"></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="${curva}" fill="none" stroke="var(--status-warn)" stroke-width="1.5"
                  vector-effect="non-scaling-stroke" stroke-linejoin="round"></polyline>
      </svg>
    </div>
    ${filas.map((p) => {
      const on = p.cumPct <= UMBRAL_PARETO;
      return `
      <div class="f">
        <span class="nom${on ? ' dentro' : ''}">${esc(p.name)}</span>
        <span class="pista"><i class="${on ? 'dentro' : ''}" style="width:${Math.round((p.count / max) * 100)}%"></i></span>
        <span class="n">${p.count}</span>
        <span class="acum${on ? ' dentro' : ''}">${p.cumPct}%</span>
      </div>`;
    }).join('')}`;
}

function pintarPorTipo() {
  const total = (D.catCounts || []).reduce((a, c) => a + c[1], 0) || 1;
  $('#por-tipo').innerHTML = (D.catCounts || []).map(([nombre, n]) => {
    const pct = Math.round((n / total) * 100);
    return `
      <div class="f">
        <div class="cab"><span>${esc(nombre)}</span><b>${n} · ${pct}%</b></div>
        <span class="pista"><i style="width:${pct}%;background:${COLOR_TIPO[nombre] || 'var(--gray-400)'}"></i></span>
      </div>`;
  }).join('');
}

// ------------------------------------------------------- impacto en la carga

const DESENLACE = {
  'Cargo': { label: 'Cargó igual', color: 'var(--status-ok)', texto: 'var(--carbon-950)' },
  'Demora en carga': { label: 'Demoró la carga', color: 'var(--status-warn)', texto: 'var(--carbon-950)' },
  'Se retira': { label: 'Se retiró de playa', color: 'var(--ttfa-red)', texto: 'var(--white)' }
};

function pintarImpacto() {
  const im = D.impacto || {};
  const total = im.total || 1;

  $('#impacto-eyebrow').textContent = `${im.total} observaciones con desenlace registrado · histórico completo`;

  const salidas = (im.outcome || []).map((o) => {
    const m = DESENLACE[o.key] || { label: o.key, color: 'var(--graphite-600)', texto: 'var(--white)' };
    return { ...o, ...m, pct: Math.round((o.n / total) * 100) };
  });

  $('#impacto-cinta').innerHTML = salidas.map((o) =>
    // El numero va adentro de la franja solo si entra: en una de 4% queda
    // encimado con el de al lado y no se lee ninguno.
    `<i style="width:${o.pct}%;background:${o.color};color:${o.texto}">${o.pct >= 8 ? o.pct + '%' : ''}</i>`).join('');

  $('#impacto-leyenda').innerHTML = salidas.map((o) => `
    <span class="f">
      <i style="background:${o.color}"></i>
      <span>${esc(o.label)}</span>
      <b>${o.n}</b>
      <small>${o.pct}%</small>
    </span>`).join('');

  // % que frena la carga, por tipo de control
  const cats = im.cats || [];
  const maxFreno = Math.max(1, ...cats.map((c) => c.frenoPct || 0));
  $('#impacto-tipos').innerHTML = cats.map((c) => {
    const color = (c.frenoPct || 0) >= 25 ? 'var(--ttfa-red)'
      : (c.frenoPct || 0) >= 10 ? 'var(--status-warn)' : 'var(--status-ok)';
    return `
      <div class="f">
        <div class="cab"><span>${esc(c.name)}</span><b style="color:${color}">${c.frenoPct}%</b></div>
        <span class="pista" style="border-radius:2px"><i style="width:${Math.round(((c.frenoPct || 0) / maxFreno) * 100)}%;background:${color};border-radius:2px"></i></span>
      </div>`;
  }).join('');

  // La lectura que importa, escrita: el tipo con mas volumen casi nunca frena.
  const porVolumen = cats.slice().sort((a, b) => b.n - a.n)[0];
  const porFreno = cats.slice().sort((a, b) => (b.frenoPct || 0) - (a.frenoPct || 0))[0];
  $('#impacto-nota').textContent = porVolumen && porFreno && porVolumen.name !== porFreno.name
    ? `${porVolumen.name} es el de mayor volumen (${porVolumen.n} observaciones) y frena la carga el ${porVolumen.frenoPct}% de las veces. ${porFreno.name} frena el ${porFreno.frenoPct}%.`
    : '';

  const maxPct = Math.max(1, ...(im.topFreno || []).map((f) => f.pct || 0));
  $('#impacto-freno').innerHTML = (im.topFreno || []).map((f) => {
    const color = (f.pct || 0) >= 50 ? 'var(--ttfa-red)' : 'var(--status-warn)';
    return `
      <div class="f">
        <span class="nom">${esc(f.name)}</span>
        <span class="n">${f.freno} de ${f.n}</span>
        <span class="caja">
          <span class="pista"><i style="width:${Math.round(((f.pct || 0) / maxPct) * 100)}%;background:${color}"></i></span>
          <span class="pct" style="color:${color}">${f.pct}%</span>
        </span>
      </div>`;
  }).join('');

  const serie = im.trend || [];
  const maxT = Math.max(1, ...serie.map((t) => t.pct || 0));
  $('#impacto-tendencia').innerHTML = serie.map((t) => {
    const color = (t.pct || 0) >= 12 ? 'var(--ttfa-red)'
      : (t.pct || 0) >= 6 ? 'var(--status-warn)' : 'var(--status-ok)';
    return `
      <div class="d">
        <span style="color:${color}">${t.pct}%</span>
        <i style="height:${Math.round(((t.pct || 0) / maxT) * 76) + 3}px;background:${color}"></i>
        <small>${esc(t.label)}</small>
      </div>`;
  }).join('');
}

// ------------------------------------------------------------ reincidencia

function pintarReincidencia() {
  const rc = D.reincidencia || {};
  const total = (rc.corregido || 0) + (rc.reincidio || 0) + (rc.sinRecontrol || 0) || 1;

  $('#reinc-tasa').textContent = rc.tasa != null ? rc.tasa : '—';
  $('#reinc-mediana').textContent = rc.medianaDias != null
    ? `mediana de ${rc.medianaDias} días hasta la reaparición`
    : '';
  $('#reinc-watch-meta').textContent = rc.watchTotal ? `${rc.watchTotal} equipos en total` : '';

  const barras = [
    { label: 'Corregido en el control siguiente', valor: rc.corregido || 0, color: 'var(--status-ok)' },
    { label: 'Reincidió con el mismo desvío', valor: rc.reincidio || 0, color: 'var(--ttfa-red)' },
    { label: 'Sin re-control posterior', valor: rc.sinRecontrol || 0, color: 'var(--graphite-600)' }
  ].map((b) => ({ ...b, pct: Math.round((b.valor / total) * 100) }));

  $('#reinc-cinta').innerHTML = barras.map((b) => `<i style="width:${b.pct}%;background:${b.color}"></i>`).join('');
  $('#reinc-leyenda').innerHTML = barras.map((b) => `
    <span class="f">
      <i style="background:${b.color}"></i>
      <span>${esc(b.label)}</span>
      <b>${b.valor}</b>
      <small>${b.pct}%</small>
    </span>`).join('');

  $('#reinc-watchlist').innerHTML = (rc.watchlist || []).map((w) => `
    <div class="f">
      <span class="eq">${esc(w.eq)}</span>
      <span class="txt">
        <span>${esc(w.dv)}</span>
        <small>${w.repeats} repeticiones · último ${fmtFecha(w.lastDate)} · ${w.ctrlCount} controles en 90 d</small>
      </span>
      <span class="dots">
        ${(w.dots || []).map((d) => `<i style="background:${d.ng ? 'var(--ttfa-red)' : 'var(--status-ok)'}"></i>`).join('')}
      </span>
      <span class="badge ${w.estado === 'abierto' ? 'risk' : 'ok'}">${w.estado === 'abierto' ? 'Abierto' : 'Corregido'}</span>
    </div>`).join('') || '<p class="nota">Ningún equipo repite desvío en los últimos 90 días.</p>';
}

// ------------------------------------------------------ traficos y auditores

function pintarTraficos() {
  $('#traficos').innerHTML = (D.traficoTrend || []).slice(0, 5).map((t) => {
    const meses = t.monthly || [];
    const vals = meses.map((m) => m.pct).filter((v) => v != null);
    const sube = vals.length > 1 && vals[vals.length - 1] > vals[0];
    const colorLinea = sube ? 'var(--ttfa-red)' : 'var(--status-ok)';
    const n = meses.length || 1;

    // Escala 0-100: son porcentajes, y fijar el eje deja comparar un trafico
    // con otro. Con escala propia por fila, dos pendientes iguales mienten.
    const pts = meses.map((m, i) => ({
      left: (((i + 0.5) / n) * 100).toFixed(2),
      bottom: m.pct == null ? null : m.pct.toFixed(2),
      pct: m.pct, n: m.n
    }));
    const linea = pts.filter((p) => p.bottom != null)
      .map((p) => `${p.left},${(100 - Number(p.bottom)).toFixed(2)}`).join(' ');

    return `
      <div class="f">
        <div class="nom">
          <span>${esc(t.name)}</span>
          <small>${t.totalN} controles</small>
        </div>
        <div class="graf">
          <div class="borde" style="top:0"></div>
          <div class="borde" style="bottom:0"></div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points="${linea}" fill="none" stroke="${colorLinea}" stroke-width="2"
                      vector-effect="non-scaling-stroke" stroke-linejoin="round"></polyline>
          </svg>
          ${pts.map((p) => p.bottom == null ? '' : `
            <i style="left:${p.left}%;bottom:${p.bottom}%;background:${colorPct(p.pct)}"></i>
            <span class="val" style="left:${p.left}%;color:${colorPct(p.pct)}">${p.pct}%</span>
            <span class="n" style="left:${p.left}%">${p.n}</span>`).join('')}
        </div>
        <span style="color:${colorLinea}">${ico(sube ? 'trending-up' : 'trending-down', 15)}</span>
      </div>`;
  }).join('');
}

function pintarAuditores() {
  const bench = D.auditorBench || {};
  const lista = bench.list || [];
  const prom = bench.teamPct != null ? bench.teamPct
    : Math.round(lista.reduce((a, x) => a + x.pct, 0) / (lista.length || 1));
  const max = Math.max(1, ...lista.map((a) => a.pct));

  $('#auditores').innerHTML = lista.map((a) => {
    const alto = a.pct > prom;
    const color = alto ? 'var(--ttfa-red)' : 'var(--status-ok)';
    return `
      <div class="f">
        <div class="cab"><span>${esc(a.name)}</span><small>${a.n} controles · ${a.pct}% NG</small></div>
        <div class="pista">
          <i style="width:${Math.round((a.pct / max) * 100)}%;background:${color}"></i>
          <span class="prom" style="left:${Math.round((prom / max) * 100)}%"></span>
        </div>
        <span class="lectura" style="color:${alto ? color : 'var(--text-faint)'}">
          ${signo(a.pct - prom)} pp vs. promedio del equipo (${prom}%)
        </span>
      </div>`;
  }).join('') || '<p class="nota">Sin datos de auditores.</p>';
}

// ------------------------------------------------------------------ operativo

function pintarOperativo() {
  const caja = $('#operativo');
  // Solo tiene sentido en la vista mensual: al lado de doce meses de historia,
  // "controles de hoy" es ruido.
  if (periodo !== 'mensual') { caja.hidden = true; return; }
  caja.hidden = false;

  $('#op-fecha').textContent = `jornada del ${fmtFecha(D.meta.updated)}`;
  $('#op-kpis').innerHTML = `
    <div class="kpi"><span class="eq-label">Controles hoy</span><span class="valor"><b>${D.todayCount ?? 0}</b></span></div>
    <div class="kpi rojo"><span class="eq-label">Con observación</span><span class="valor"><b>${D.todayNg ?? 0}</b></span></div>`;

  $('#op-pendientes').innerHTML = (D.pendientes || []).map((p) => `
    <div class="f">
      <span class="eq">${esc(p.eq)}</span>
      <span class="dv">${esc(p.desvio)}</span>
      <span class="der">${fmtFecha(p.date)}</span>
    </div>`).join('') || '<p class="nota">Nada pendiente en las últimas 72 h.</p>';

  const obs = (D.todayFeed || []).filter((f) => f.ng);
  $('#op-obs-eyebrow').textContent = `${obs.length} de ${D.todayCount ?? 0} controles`;
  $('#op-obs').innerHTML = obs.map((f) => `
    <div class="f">
      <span class="hora">${esc(f.time)}</span>
      <span class="eq">${esc(f.eq)}</span>
      <span class="badge sin-punto ${f.cat === 'Seguridad' ? 'risk' : 'warn'}">${esc(f.cat || 'NG')}</span>
      <span class="dv">${esc(f.desvio)}</span>
      <span class="der">${esc(f.trafico || '')}</span>
    </div>`).join('') || '<p class="nota">Ninguna observación hoy.</p>';
}

// -------------------------------------------------------------------- render

function pintar() {
  $('#subtitulo').textContent = periodo === 'anual'
    ? `Últimos 12 meses · ${D.meta.total} controles históricos`
    : `${D.meta.curMonthLabel} · actualizado ${fmtFecha(D.meta.updated)}`;

  pintarLateral();
  pintarPeriodo();
  pintarKpis();
  pintarEvolucion();
  pintarDetalle();
  pintarPareto();
  pintarPorTipo();
  pintarImpacto();
  pintarReincidencia();
  pintarTraficos();
  pintarAuditores();
  pintarOperativo();

  $('#cargando').hidden = true;
  $('#contenido').hidden = false;
}

async function cargar() {
  $('#cargando').hidden = false;
  $('#cargando').textContent = 'Cargando el período…';
  try {
    D = await Datos.traer(periodo);
    pintar();
  } catch (e) {
    $('#contenido').hidden = true;
    $('#cargando').hidden = false;
    $('#cargando').textContent = e.message === 'sesion_invalida'
      ? 'Se venció la sesión. Volvé a entrar a la intranet.'
      : 'No se pudo traer el tablero.';
  }
}

// -------------------------------------------------------------------- eventos

document.addEventListener('click', (e) => {
  const p = e.target.closest('[data-p]');
  if (p) {
    if (p.dataset.p === periodo) return;
    periodo = p.dataset.p;
    elegido = null;   // el detalle es de otro corte, no se arrastra
    cargar();
    return;
  }

  const k = e.target.closest('[data-k]');
  if (k) {
    const clave = k.dataset.k;
    if (!clave) return;
    elegido = elegido === clave ? null : clave;   // volver a tocar lo cierra
    pintarEvolucion();
    pintarDetalle();
    if (elegido) $('#detalle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

$('#cerrar-detalle').addEventListener('click', () => {
  elegido = null;
  pintarEvolucion();
  pintarDetalle();
});

$('#tema').addEventListener('click', () =>
  aplicarTema(document.documentElement.getAttribute('data-tema') !== 'claro'));

$('#exportar').addEventListener('click', () => {
  if (!D) return;
  const st = (periodo === 'anual' ? D.annual : D.monthly).stats;
  const filas = [
    ['Desvío', 'Casos', '% acumulado'],
    ...(st.pareto || []).map((p) => [p.name, p.count, p.cumPct])
  ];
  Datos.exportarCsv(`patrullas-${periodo}-${D.meta.updated || 'hoy'}.csv`, filas);
});

// ------------------------------------------------------------------- arranque

aplicarTema(document.documentElement.getAttribute('data-tema') === 'claro');
pintarLateral();
cargar();
