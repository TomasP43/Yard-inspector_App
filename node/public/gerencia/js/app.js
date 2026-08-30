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

// Se fue COLOR_TIPO con el campo "tipo de control": pintaba las barras del
// desglose por tipo, que ya no existe. Ver YI-008.
const MESES = { '01': 'ene', '02': 'feb', '03': 'mar', '04': 'abr', '05': 'may', '06': 'jun',
                '07': 'jul', '08': 'ago', '09': 'sep', '10': 'oct', '11': 'nov', '12': 'dic' };

/** Umbral del Pareto: hasta donde se considera "lo que concentra el problema". */
const UMBRAL_PARETO = 80;

let D = null;                 // el tablero que devolvio el servidor
let periodo = 'anual';
let pantalla = 'patrullas';   // patrullas | precarga
let elegido = null;           // clave del mes o del dia abierto en el detalle
let empresa = null;           // transportista que filtra el Pareto

/** Los datos de la empresa filtrada, o null si estan todas. */
const empresaSel = () => (empresa ? (D.empresas || []).find((e) => e.name === empresa) : null) || null;

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

/**
 * Semaforo de retiros, sobre `z` -- a cuantos errores estandar del promedio
 * esta la tasa del mes. Lo calcula el servidor con el volumen de cada mes
 * (p-chart), asi que aca no hay ningun umbral en porcentaje escrito a mano: si
 * el volumen o la tasa cambian de nivel, los cortes se mueven solos.
 *
 * El umbral anterior era `>= 8%` y estaba pensado para retiros sobre controles.
 * Con la tasa sobre camiones movidos, que ronda el 1%, no se encendia nunca.
 *
 * AMARILLO y ROJO son las dos unicas constantes del semaforo. 1 y 2 sigma es lo
 * estandar: con un proceso estable serian ~27% de meses en amarillo y ~5% en
 * rojo. Subir AMARILLO a 1.5 apaga los amarillos de borde.
 */
const AMARILLO = 1;
const ROJO = 2;

const colorZ = (z) =>
  z == null ? 'var(--text-faint)'
  : z >= ROJO ? 'var(--ttfa-red)'
  : z >= AMARILLO ? 'var(--status-warn)'
  : 'var(--status-ok)';

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

// -------------------------------------------------------------- barra lateral

/**
 * La barra se cierra, igual que el cajon de la PWA.
 *
 * Con un solo item de menu, 232px fijos para la marca y el usuario es mucho
 * para una pantalla que lo que quiere es ancho. El que la cierra se la queda
 * cerrada: la eleccion se guarda al lado del tema.
 *
 * Debajo de 1100px deja de estar anclada y se corre POR ENCIMA del tablero,
 * que es exactamente el cajon del telefono -- ahi el estado no se guarda y
 * arranca siempre cerrada, porque abierta taparia lo que se vino a mirar. El
 * quiebre lo decide el CSS; aca solo se consulta para saber cual de las dos
 * cosas esta pasando.
 */
const ANGOSTA = window.matchMedia('(max-width: 1099px)');
const CLAVE_LATERAL = 'yard-lateral';

function lateralGuardada() {
  if (ANGOSTA.matches) return false;
  try { return localStorage.getItem(CLAVE_LATERAL) !== 'cerrada'; } catch (e) { return true; }
}

let lateralAbierta = lateralGuardada();

function aplicarLateral() {
  const raiz = document.documentElement;
  if (lateralAbierta) raiz.removeAttribute('data-lateral');
  else raiz.setAttribute('data-lateral', 'cerrada');

  // El velo solo importa cuando la barra tapa el tablero. En pantalla ancha
  // el CSS lo apaga, asi que alcanza con seguir el estado.
  $('#velo').hidden = !lateralAbierta;

  const b = $('#abrir');
  b.innerHTML = ico('menu', 18);
  b.setAttribute('aria-expanded', String(lateralAbierta));
  b.setAttribute('aria-label', lateralAbierta ? 'Cerrar el menú' : 'Abrir el menú');
}

function alternarLateral() {
  lateralAbierta = !lateralAbierta;
  aplicarLateral();
  if (ANGOSTA.matches) return;   // el modo cajon no deja preferencia
  try {
    localStorage.setItem(CLAVE_LATERAL, lateralAbierta ? 'abierta' : 'cerrada');
  } catch (e) { /* modo privado */ }
}

// Al cruzar el quiebre se vuelve a decidir desde cero: viniendo de ancha la
// barra quedaria abierta encima del tablero, y volviendo a ancha hay que
// recuperar lo que el usuario habia elegido.
ANGOSTA.addEventListener('change', () => {
  lateralAbierta = lateralGuardada();
  aplicarLateral();
});

// --------------------------------------------------------------- estructura

const PANTALLAS = {
  patrullas: { titulo: 'Patrulla de calidad — tablero de gerencia', menu: 'Patrullas', icono: 'gauge' },
  precarga:  { titulo: 'Inspección de precarga — tablero de gerencia', menu: 'Precarga', icono: 'package' }
};

function pintarLateral() {
  // Dos items, y los dos llevan a algo. El diseño traia ademas "Patrulla de
  // hoy", "Historial completo" y "Equipos" apuntando a `../#hoy` y compañia --
  // la PWA no lee el hash, asi que los tres caian en la misma pantalla y
  // "Equipos" ni siquiera existia. Un menu que promete cuatro lugares y lleva a
  // uno es peor que un menu de uno; por eso quedo con los que existen.
  $('#menu').innerHTML = Object.entries(PANTALLAS).map(([k, p]) =>
    `<button type="button" class="it${pantalla === k ? ' activo' : ''}" data-pantalla="${k}">${ico(p.icono, 16)}<span>${esc(p.menu)}</span></button>`).join('');

  $('#titulo-tablero').textContent = PANTALLAS[pantalla].titulo;

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

/**
 * Los cuatro KPIs son un embudo, en numeros absolutos y todos sobre el mismo
 * denominador: **controles**.
 *
 *   controles -> con observacion -> de esos, cuantos se retiraron y cuantos
 *                                   demoraron la carga
 *
 * Retiros y demoras son subconjuntos del NG, asi que las tres tasas se comparan
 * entre si sin trampa.
 *
 * **Las cuatro cifras tienen que salir de los mismos meses.** Los controles
 * existen solo desde que se cargan los OK; mezclar retiros de doce meses con
 * controles de dos daria un porcentaje que no es de nada. Por eso el bloque
 * cubre el tramo con control cargado, no la ventana entera, y lo dice.
 *
 * Y sigue al mes que se toque en el grafico: elegido un mes, los cuatro pasan a
 * ser los de ese mes.
 */
function pintarKpis() {
  const anual = periodo === 'anual';
  const st = (anual ? D.annual : D.monthly).stats;
  const fuente = (anual ? D.monthDetail : D.dayDetail) || {};
  const sel = elegido ? fuente[elegido] : null;
  const d = sel || st.embudo;

  // El denominador es el mismo numero que encabeza el bloque, y cambia de
  // nombre segun el mes:
  //
  //   con controles cargados  -> "Controlados". Desde jul-2026 se controla todo
  //                              lo que se mueve, asi que es el volumen entero.
  //   sin controles cargados  -> "Camiones movidos", el unico que se conoce.
  //
  // Antes este bloque se restringia a los meses con control y los viejos salian
  // con "—" en las cuatro tarjetas. Ya no hace falta: los movidos se conocen
  // siempre, asi que cualquier mes tiene sobre que medirse.
  const controlado = d.n != null;
  const base = controlado ? d.n : d.volumen;
  const deQue = controlado ? 'de los controlados' : 'de los camiones movidos';

  const pct = (v) => (base && v != null ? Math.round((v / base) * 1000) / 10 + '%' : '—');

  const kpis = [
    {
      // No se divide por si mismo, obviamente. Cuando hay controles va la
      // cobertura: desde jul-2026 tiene que dar 100%, y un mes por debajo
      // significa que se dejo de controlar algo.
      label: controlado ? 'Controlados' : 'Camiones movidos',
      valor: base == null ? '—' : base, unidad: '',
      // Cuando hay controles, la cobertura. Cuando no, **cuantos meses de la
      // ventana no tienen control cargado** -- que no es lo mismo.
      //
      // Aca decia "18% del periodo fue controlado", que era 3427/19572 y se
      // leia como "se controla poco". Lo que pasa es lo contrario: en los meses
      // que tienen el dato la cobertura es 100%, y el 18% sale de que diez de
      // los doce meses no tienen control cargado porque el OK no se registraba.
      delta: controlado && d.volumen
        ? `${Math.round((d.n / d.volumen) * 100)}% de los camiones movidos`
        : sel ? 'sin controles cargados ese mes'
        : `${st.mesesConControles} de 12 meses con control cargado`,
      deltaColor: 'var(--text-muted)',
      pie: sel ? sel.label : anual ? 'últimos 12 meses' : 'mes en curso'
    },
    {
      label: 'Con observación', valor: d.ng == null ? '—' : d.ng, unidad: '', tono: 'ambar',
      delta: pct(d.ng), deltaColor: 'var(--text-muted)', pie: deQue
    },
    {
      label: 'Retiros', valor: d.rechazo == null ? '—' : d.rechazo, unidad: '', tono: 'rojo',
      delta: pct(d.rechazo), deltaColor: 'var(--text-muted)', pie: deQue
    },
    {
      label: 'Demora de carga', valor: d.demora == null ? '—' : d.demora, unidad: '', tono: 'ambar',
      delta: pct(d.demora), deltaColor: 'var(--text-muted)', pie: deQue
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

/**
 * Las cifras de la leyenda.
 *
 * Controles y retiros salen de `stats`, que es de donde salen tambien los KPIs
 * de arriba. Si se sumaran las barras aca, dos numeros de la misma pantalla
 * podrian discrepar y no habria forma de saber cual de los dos miente.
 *
 * El conteo de NG es la excepcion y si se suma: `stats` trae la tasa, no la
 * cantidad. Es sumar lo que el grafico ya dibuja para poder rotularlo, no una
 * metrica nueva sobre el historico -- que es lo que este tablero no hace.
 *
 * Y se suma **solo lo que tiene tracking**. Antes de junio de 2026 no se
 * distinguia OK de NG y esos meses vienen con `ng: null`. Contarlos como cero
 * diria que salieron todos perfectos; lo que pasa es que no se sabe.
 */
function pintarLeyenda(st, serie, anual) {
  // La aclaracion va aparte del numero: en mono parecia parte de la cifra.
  const nota = (t) => `<span>${t}</span>`;
  const unidad = anual ? 'meses' : 'días';

  // Controles: solo existen donde se cargaron los OK. Decir "4961 controles"
  // sumando los meses en que solo se cargaba el NG mezclaba dos cosas.
  // Las dos bandas de la barra, en el mismo orden en que se leen: el total
  // movido y, dentro, la parte observada.
  $('#ll-ctrl').textContent = st.volumen;
  $('#ll-ng').innerHTML =
    st.observaciones + nota(` · ${st.obsPct}% de los movidos`);

  // Los controles no estan en el grafico -- existen solo desde jul-2026 -- pero
  // se dicen, con sobre cuantos meses salen, para que el 53% del KPI de arriba
  // tenga de donde agarrarse.
  const sinDato = serie.filter((w) => w.n == null).length;
  const conDato = serie.length - sinDato;
  $('#ll-ctrl-nota').innerHTML = conDato === 0
    ? ''
    : `${st.n} controles${sinDato ? ` en ${conDato} de ${serie.length} ${unidad}` : ''}`;

  // La linea naranja se dibuja en su propia escala y no en el eje de la
  // izquierda, asi que a ojo parece del orden de las barras. El porcentaje dice
  // de que tamaño es. Va como tasa y no como cociente para no repetir el total
  // movido, que ya esta dos etiquetas mas a la izquierda.
  // El promedio se dice porque es contra el que se pinta cada mes: sin el, los
  // verdes y amarillos de abajo salen de la nada.
  $('#ll-ret').innerHTML = st.retiroProm == null
    ? String(st.rechazo)
    : st.rechazo + nota(` · ${st.retiroProm}% promedio de los movidos`);
}

function pintarEvolucion() {
  const anual = periodo === 'anual';
  const src = anual ? D.annual : D.monthly;
  const serie = src.series || [];
  const claves = Object.keys((anual ? D.monthDetail : D.dayDetail) || {});

  $('#evo-eyebrow').textContent = anual
    ? 'Camiones movidos y observados por mes · últimos 12 meses'
    : `Controles por día · ${D.meta.curMonthLabel}`;
  $('#evo-titulo').textContent = anual ? 'Evolución del año' : 'Evolución del mes';
  $('#evo-pista').textContent = anual ? 'Tocá un mes para abrir el detalle' : 'Tocá un día para abrir el detalle';

  pintarLeyenda(src.stats, serie, anual);

  // Escala redondeada a multiplos de 50: un eje con "437" arriba no se lee.
  // La escala mide lo que se dibuja, y lo que se dibuja son camiones movidos.
  const crudo = Math.max(1, ...serie.map((w) => w.volumen || 0));
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

  // Cada punto lleva su tasa: retiros sobre camiones movidos, el mismo
  // denominador que la barra. La linea va en su propia escala, asi que sin el
  // numero no hay forma de saber si un punto alto son 40 retiros o 4.
  const dots = serie.map((w, i) => {
    const x = (((i + 0.5) / n) * 100).toFixed(2);
    const yPct = ((w.rechazo || 0) / maxRet) * 92;
    const y = yPct.toFixed(2);

    // Donde poner la etiqueta de la linea.
    //
    // Compite con el numero de la barra, que ocupa una franja fija arriba del
    // techo. Ninguna posicion fija alcanza: el punto tanto puede caer sobre el
    // techo como debajo, asi que arriba-siempre y abajo-siempre chocan cada una
    // en la mitad de los meses. Se elige el lado que quede libre.
    const altoPunto = (yPct / 100) * ALTO_BARRA;
    const altoBarra = ((w.volumen || 0) / tope) * ALTO_BARRA;

    const pisa = (a, b) => a[0] < b[1] && b[0] < a[1];
    const franjaBarra = [altoBarra, altoBarra + 16];

    // Abajo si entra, arriba si no. Cuando el punto queda justo sobre el techo
    // los dos lados chocan -- ahi se salta por encima del numero de la barra,
    // que es el unico lugar que siempre queda libre.
    const donde =
      altoPunto >= 24 && !pisa([altoPunto - 22, altoPunto - 8], franjaBarra) ? ''
      : !pisa([altoPunto + 4, altoPunto + 16], franjaBarra) ? 'arriba'
      : 'arriba lejos';

    // Sin retiros no hay etiqueta. En la vista diaria los retiros son 0 a 3, y
    // rotular veinte dias con "0%" tapa los cuatro que si tienen algo.
    const pct = !w.rechazo || w.rechazoPct == null ? '' :
      `<b class="${donde}" style="left:${x}%;bottom:${y}%">${w.rechazoPct}%</b>`;
    return `<i style="left:${x}%;bottom:${y}%"></i>${pct}`;
  }).join('');

  // Marca del mes en que se empezo a cargar el control. Va entre la ultima
  // barra sin control y la primera con, no encima de ninguna, porque el cambio
  // ocurre en el medio. Sin entrada en la leyenda: la linea sola alcanza y el
  // texto ocupaba media fila.
  const iCorte = serie.findIndex((w) => w.n != null);
  const corte = (iCorte > 0 && serie.some((w) => w.n == null))
    ? `<div class="corte" style="left:${((iCorte / n) * 100).toFixed(2)}%"></div>`
    : '';

  const cols = serie.map((w, i) => {
    const k = claves[i];
    const sel = k && k === elegido;

    // Dos colores y un solo significado: el alto es el total de camiones
    // movidos y el rojo es la parte de ese total que tuvo observacion. La
    // fraccion roja **es** la tasa, asi que se lee sin leer el numero.
    //
    // El denominador no cambia nunca. Los controles existen solo desde
    // jul-2026, y una serie que cambiara de denominador en el medio daria un
    // salto de 12% a 49% que es de metodo y no de calidad.
    const alto = Math.round((w.volumen / tope) * ALTO_BARRA) + 2;
    const altoNg = Math.round(((w.ng || 0) / tope) * ALTO_BARRA);

    return `
      <button type="button" class="col${sel ? ' sel' : ''}" data-k="${esc(k || '')}">
        <small style="color:${sel ? 'var(--text-strong)' : 'var(--text-muted)'};font-weight:${sel ? '600' : '400'}">
          ${w.obsPct == null ? '—' : w.obsPct + '%'}
        </small>
        <span class="barra" style="height:${alto}px"><i style="height:${altoNg}px"></i></span>
      </button>`;
  }).join('');

  $('#evo-plot').innerHTML = `
    ${guias}
    ${corte}
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
    const cRet = colorZ(w.retiroZ);
    return `
      <button type="button" data-k="${esc(k || '')}">
        <span style="color:${color}">${esc(w.label)}</span>
        <span style="color:${cRet}">${w.rechazo ? w.rechazo + ' ret.' : '0'}</span>
      </button>`;
  }).join('');
}

// ---------------------------------------------------------------- detalle

/**
 * "3 de 37" cuando la lista no trae todos los retiros del mes.
 *
 * El KPI de arriba dice cuantos hubo y la lista de abajo muestra los que
 * llegaron. Si el servidor recorta y la pantalla no lo dice, las dos cifras se
 * contradicen y no hay forma de saber cual es la buena -- el mock llego a decir
 * "37 retiros" arriba y "Ningun retiro este mes" abajo.
 *
 * Cuando coinciden no se dice nada: un "37 de 37" es ruido.
 */
function etiquetaLista(lista, total) {
  const hay = (lista || []).length;
  return total == null || hay === total ? '' : ` · ${hay} de ${total}`;
}

function pintarDetalle() {
  const caja = $('#detalle');
  const anual = periodo === 'anual';
  const fuente = (anual ? D.monthDetail : D.dayDetail) || {};
  const d = elegido ? fuente[elegido] : null;

  if (!d) { caja.hidden = true; return; }
  caja.hidden = false;

  $('#detalle-titulo').textContent = d.label || elegido;

  // Misma regla que el bloque de arriba: la primera celda cambia de nombre
  // segun el mes y las otras dos se dividen por ese numero. Aca habia quedado
  // la logica vieja, que en un mes sin control cargado mostraba "Controles —"
  // con el total movido de renglon chiquito. El numero estaba, pero en el lugar
  // equivocado y detras de un guion.
  const controlado = d.n != null;
  const base = controlado ? d.n : d.volumen;
  const sobre = controlado ? 'de los controlados' : 'de los camiones movidos';
  const tasa = (v) => (base && v != null ? Math.round((v / base) * 1000) / 10 + '% ' + sobre : '—');

  $('#detalle-kpis').innerHTML = `
    <div>
      <span class="eq-label">${controlado ? 'Controlados' : 'Camiones movidos'}</span>
      <b>${base == null ? '—' : base}</b>
      <small>${controlado && d.volumen
        ? Math.round((d.n / d.volumen) * 100) + '% de los camiones movidos'
        : 'sin controles cargados ese mes'}</small>
    </div>
    <div>
      <span class="eq-label">Con observación</span>
      <b class="ambar">${d.ng == null ? '—' : d.ng}</b>
      <small>${tasa(d.ng)}</small>
    </div>
    <div>
      <span class="eq-label">Retiros</span>
      <b class="rojo">${d.rechazo == null ? '—' : d.rechazo}</b>
      <small>${tasa(d.rechazo)}</small>
    </div>`;

  $('#detalle-cuerpo').innerHTML = anual ? detalleMes(d) : detalleDia(d);
}

function detalleMes(d) {
  // Ordenar de mayor a menor aca y no confiar en que venga ordenado: las dos
  // columnas se llaman "Top desvios" y "Equipos con mas NG", asi que si el
  // orden no lo garantiza la pantalla, el titulo puede quedar mintiendo. Son
  // cinco filas ya agregadas por el servidor; ordenarlas es presentacion.
  const lista = (arr, mono) => [...(arr || [])]
    .sort((a, b) => b.count - a.count)
    .map((x) => `
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
        <span class="eq-label">Retiros del mes${etiquetaLista(d.rechazoList, d.rechazo)}</span>
        <div class="lista detalle-scroll">
          ${(d.rechazoList || []).map((r) => `
            <div class="f" style="border-bottom:1px solid var(--line-hairline);padding:7px 0">
              <span class="mono" style="width:44px;flex:0 0 44px;font-size:11px;color:var(--text-faint)">${esc(r.dayLabel || fmtFecha(r.date))}</span>
              <span class="mono-eq" style="width:48px;flex:0 0 48px">${esc(r.eq)}</span>
              <span style="flex:1;min-width:0;font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.desvio)}</span>
            </div>`).join('') || `<p class="nota">${d.rechazo
              ? 'Los retiros de este mes no vinieron en el detalle.'
              : 'Ningún retiro este mes.'}</p>`}
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
          <span class="badge sin-punto ${r.ng ? 'warn' : 'ok'}">${r.ng ? 'NG' : 'OK'}</span>
          <span class="dv">${esc(r.desvio || 'Sin desvíos')}</span>
          <span class="der">${esc(r.trafico || '')}</span>
        </div>`).join('') || '<p class="nota">Sin controles ese día.</p>'}
    </div>`;
}

// ----------------------------------------------------------------- pareto

function pintarPareto() {
  const base = (periodo === 'anual' ? D.annual : D.monthly).stats;
  // Con una empresa elegida, el Pareto es el de ella. `paretoAparte` viaja
  // junto, porque el peso del oxido tambien cambia por empresa.
  const st = empresaSel() || base;
  const filas = st.pareto || [];

  const dentro = filas.filter((p) => p.cumPct <= UMBRAL_PARETO).length || filas.length;
  $('#pareto-eyebrow').textContent =
    `${dentro} desvíos explican el ${UMBRAL_PARETO}% del resto${empresa ? ` · ${empresa}` : ''}`;
  $('#pareto-titulo').textContent = 'Desvíos que concentran el problema';

  // Lo que quedo afuera de la tabla. El oxido solo es la mitad de los desvios:
  // adentro contesta siempre lo mismo y tapa a los otros diez. Su peso se dice
  // aca, que es lo unico que ese renglon aportaba.
  const ap = st.paretoAparte;
  $('#pareto-aparte').hidden = !ap;
  if (ap) {
    $('#pareto-aparte').innerHTML = `
      <span class="eq-label">Fuera de la tabla</span>
      <span class="fila">
        <b>${esc(ap.name)}</b>
        <span class="cifra">${esc(ap.count)}</span>
        <span class="pct">${esc(ap.pct)}%</span>
      </span>`;
  }
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

/**
 * Tasa de NG por transportista: NG sobre los camiones que movio esa empresa.
 *
 * **Cada barra tiene su propio denominador**, asi que no suman 100 y por eso no
 * es una torta: una torta reparte un total entre sus partes y esto no es un
 * total repartido. La barra se dibuja contra la peor tasa, no contra 100, que
 * si todas rondan el 15% doce barras cortas no dejan comparar nada.
 *
 * Dividir por el volumen propio es el punto: sin eso, la empresa que mas mueve
 * encabeza siempre por mover mas, no por andar peor.
 */
function pintarPorEmpresa() {
  const lista = [...(D.empresas || [])].sort((a, b) => b.pct - a.pct);
  const peor = Math.max(1, ...lista.map((e) => e.pct));

  // La referencia es la tasa de toda la flota, que ya viene calculada. Los
  // cortes de `colorPct` no sirven aca: son para NG sobre controles, donde 55%
  // es malo, y esta tasa ronda el 15% -- pintaria todo de verde siempre. Estar
  // por encima del promedio de la flota si es una referencia de verdad.
  const prom = (periodo === 'anual' ? D.annual : D.monthly).stats.obsPct;

  $('#por-empresa').innerHTML = lista.map((e) => `
    <button type="button" class="f${e.name === empresa ? ' sel' : ''}" data-emp="${esc(e.name)}"
            aria-pressed="${e.name === empresa}">
      <div class="cab">
        <span>${esc(e.name)}</span>
        <b>${esc(e.pct)}% <small>${esc(e.ng)} de ${esc(e.volumen)}</small></b>
      </div>
      <span class="pista"><i style="width:${(e.pct / peor) * 100}%;background:${
        prom != null && e.pct > prom ? 'var(--ttfa-red)' : 'var(--status-ok)'}"></i></span>
    </button>`).join('') || '<p class="nota">Sin datos por empresa.</p>';

  $('#empresa-nota').textContent = !lista.length ? ''
    : empresa ? `Mostrando ${empresa}. Tocá de nuevo para ver todas.`
    : prom == null ? 'Tocá una empresa para filtrar las dos tarjetas.'
    : `Rojo: por encima del ${prom}% de la flota · tocá una para filtrar`;
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

  // Aca estaba "% que frena la carga, por tipo de control", con la nota de que
  // el tipo de mayor volumen casi nunca frena. Se fue con el campo (YI-008):
  // el desglose por desvio dice lo mismo y ademas dice cual.

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

  // Que el oxido esta afuera se dice. Un filtro que no se ve es peor que no
  // filtrar: el desvio mas grande falta de la lista y nadie sabe por que.
  $('#reinc-eyebrow').textContent =
    `Qué pasó después de cada observación · histórico completo${
      rc.excluye ? ` · sin ${rc.excluye.toLowerCase()}` : ''}`;

  // El oxido salio de la tarjeta, pero sigue pasando: cuantos equipos lo tienen
  // abierto ahora mismo es el dato que esas filas aportaban.
  const ox = rc.oxidoActivo;
  $('#reinc-aparte').hidden = !ox;
  if (ox) {
    const pct = ox.deTotal ? Math.round((ox.equipos / ox.deTotal) * 100) : null;
    $('#reinc-aparte').innerHTML = `
      <span class="eq-label">Con óxido abierto</span>
      <span class="fila">
        <b>${esc(ox.equipos)} equipos</b>
        ${pct == null ? '' : `<span class="pct">${pct}%</span>`}
      </span>`;
  }

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
      <span class="badge sin-punto warn">NG</span>
      <span class="dv">${esc(f.desvio)}</span>
      <span class="der">${esc(f.trafico || '')}</span>
    </div>`).join('') || '<p class="nota">Ninguna observación hoy.</p>';
}

// -------------------------------------------------------------------- render

function pintar() {
  $('#subtitulo').textContent = periodo === 'anual'
    ? `Últimos 12 meses · ${D.meta.total} registros históricos`
    : `${D.meta.curMonthLabel} · actualizado ${fmtFecha(D.meta.updated)}`;

  pintarLateral();
  pintarPeriodo();
  pintarKpis();
  pintarEvolucion();
  pintarDetalle();
  pintarPareto();
  pintarPorEmpresa();
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
    if (pantalla === 'precarga') {
      await TableroPrecarga.cargar(periodo);
      $('#cargando').hidden = true;
      $('#contenido').hidden = true;
      $('#contenido-precarga').hidden = false;
      return;
    }
    D = await Datos.traer(periodo);
    $('#contenido-precarga').hidden = true;
    pintar();
  } catch (e) {
    $('#contenido').hidden = true;
    $('#contenido-precarga').hidden = true;
    $('#cargando').hidden = false;
    $('#cargando').textContent = e.message === 'sesion_invalida'
      ? 'Se venció la sesión. Volvé a entrar a la intranet.'
      : 'No se pudo traer el tablero.';
  }
}

// -------------------------------------------------------------------- eventos

document.addEventListener('click', (e) => {
  const pa = e.target.closest('[data-pantalla]');
  if (pa) {
    if (pa.dataset.pantalla === pantalla) return;
    pantalla = pa.dataset.pantalla;
    elegido = null;       // el detalle es de la otra pantalla, no se arrastra
    empresa = null;
    pintarLateral();
    if (ANGOSTA.matches && lateralAbierta) alternarLateral();   // en angosto tapa lo que se vino a ver
    cargar();
    return;
  }

  const p = e.target.closest('[data-p]');
  if (p) {
    if (p.dataset.p === periodo) return;
    periodo = p.dataset.p;
    elegido = null;   // el detalle es de otro corte, no se arrastra
    cargar();
    return;
  }

  const emp = e.target.closest('[data-emp]');
  if (emp) {
    // Volver a tocarla muestra todas otra vez, igual que con los meses.
    empresa = empresa === emp.dataset.emp ? null : emp.dataset.emp;
    pintarPorEmpresa();
    pintarPareto();
    return;
  }

  const k = e.target.closest('[data-k]');
  if (k) {
    const clave = k.dataset.k;
    if (!clave) return;
    elegido = elegido === clave ? null : clave;   // volver a tocar lo cierra
    pintarKpis();                                 // los KPIs siguen al elegido
    pintarEvolucion();
    pintarDetalle();
    if (elegido) $('#detalle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

$('#cerrar-detalle').addEventListener('click', () => {
  elegido = null;
  pintarKpis();
  pintarEvolucion();
  pintarDetalle();
});

$('#abrir').addEventListener('click', alternarLateral);
$('#velo').addEventListener('click', alternarLateral);

// Escape solo cierra cuando la barra esta tapando algo. Anclada no molesta, y
// cerrarla desde el teclado sin querer seria un cambio que ademas se guarda.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lateralAbierta && ANGOSTA.matches) alternarLateral();
});

$('#tema').addEventListener('click', () =>
  aplicarTema(document.documentElement.getAttribute('data-tema') !== 'claro'));

$('#exportar').addEventListener('click', () => {
  if (pantalla === 'precarga') {
    const filas = TableroPrecarga.filasCsv();
    if (filas) Datos.exportarCsv(`precarga-${periodo}.csv`, filas);
    return;
  }
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
aplicarLateral();
pintarLateral();
cargar();
