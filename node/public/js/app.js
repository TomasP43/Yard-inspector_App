'use strict';

/**
 * Yard Inspector — UI.
 *
 * Cuatro pantallas (Tablero, Hoy, Historial, Cargar) mas el detalle por equipo,
 * segun el diseño del proyecto de Claude Design "UI mockups pending details".
 *
 * Todo lo que se muestra sale de dos endpoints que ya existian: la ventana de
 * los ultimos dias y el historial paginado. Las metricas se calculan aca, en el
 * navegador. Son dos inspectores y unas decenas de controles por jornada: no
 * justifica un endpoint de metricas, y ademas asi el tablero sigue mostrando
 * algo contra el cache cuando no hay senal.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const ico = (n, s) => Iconos.svg(n, s);

/** Dias de historia que se traen para el tablero y la vista de hoy. */
const DIAS_VENTANA = 14;

// Se fueron COLOR_TIPO y TIPOS con el campo "tipo de control": las filas se
// pintaban con el color del tipo y el historial se filtraba por el. Ver YI-008.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

let CAT = null;         // catalogos
let VENTANA = null;     // respuesta de los ultimos DIAS_VENTANA dias
let vista = 'hoy';
let vistaPrevia = 'hoy';
let equipoDetalle = null;

/**
 * Los controles que ya se dibujaron, por uuid.
 *
 * El detalle de un control no vuelve a pedirlo al servidor: la fila que se toco
 * ya trae todo. Ademas asi el detalle abre sin senal, que es la mitad del
 * sentido de esta app.
 */
const VISTOS = new Map();
let soloNg = false;
let filtro = 'Todos';
let offsetHistorial = 0;
let vistosHistorial = 0;   // filas mostradas, acumulado

// El formulario vive en un objeto y no en el DOM: hay estado (zona actual,
// desvios marcados, resoluciones) que no corresponde a ningun input.
let form = null;
function formVacio() {
  return {
    ng: true, zona: 0, desvios: new Set(),
    demora: 'Cargo', fotos: [], checklist: null, resoluciones: {},
    pendientes: null // ultimo control NG de este equipo, si lo hay
  };
}

// ------------------------------------------------------------------ utilidades

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const dia0 = (x) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d; };
const claveDia = (x) => { const d = dia0(x); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const hhmm = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "Hoy" / "Ayer" / "14 ago". Un dia con nombre se ubica sin pensar. */
function fmtDia(iso) {
  const hoy = dia0(new Date());
  const d = dia0(iso);
  const dif = Math.round((hoy - d) / 86400000);
  if (dif === 0) return 'Hoy';
  if (dif === 1) return 'Ayer';
  return d.getDate() + ' ' + MESES[d.getMonth()];
}

const turno = (iso) => (new Date(iso).getHours() < 13 ? 'Turno mañana' : 'Turno tarde');

/** 'Trafico Brasil' se muestra 'Brasil': el prefijo se repite en cada fila. */
const trafico = (r) => (r && r.nombre ? r.nombre.replace(/^Tr[aá]fico\s+/i, '') : '—');

function nombreCorto(u) {
  if (!u) return '';
  const n = (u.nombre || '').trim();
  if (n) return n.split(/\s+/)[0];
  return (u.email || '').split('@')[0];
}

function iniciales(u) {
  if (!u) return '';
  const n = (u.nombre || '').trim();
  if (n) {
    const p = n.split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  return (u.email || '').split('@')[0].slice(0, 2).toUpperCase();
}

function estado(texto, clase) {
  const el = $('#estado');
  if (!texto) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = texto;
  el.className = 'estado ' + (clase || '');
}

let tToast;
function toast(titulo, msg, malo) {
  const el = $('#toast');
  $('#toast-ico').innerHTML = ico(malo ? 'octagon-alert' : 'circle-check', 17);
  $('#toast-titulo').textContent = titulo;
  $('#toast-msg').textContent = msg || '';
  el.className = 'toast' + (malo ? ' malo' : '');
  el.hidden = false;
  clearTimeout(tToast);
  tToast = setTimeout(() => { el.hidden = true; }, 3400);
}

async function pedir(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (r.status === 401) { estado('Sesión vencida', 'malo'); throw new Error('401'); }
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

// -------------------------------------------------------------------- tema

function aplicarTema(claro) {
  const raiz = document.documentElement;
  if (claro) raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');
  $('#tema').innerHTML = ico(claro ? 'moon' : 'sun', 16);
  $('#tema').setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', claro ? '#ffffff' : '#101113');
  try { localStorage.setItem('yard-tema', claro ? 'claro' : 'oscuro'); } catch (e) { /* modo privado */ }
}

// -------------------------------------------------------------- catalogos

/** Sirve si trae al menos lo que arma el formulario. */
const catalogoUsable = (c) => !!(c && Array.isArray(c.responsables) && Array.isArray(c.desvios));

/** true cuando IndexedDB no contesta: sin ella no hay cola ni offline. */
let SIN_BASE = false;

async function cargarCatalogos() {
  // Envuelto: si IndexedDB no contesta, esta linea reventaba antes del try y se
  // llevaba puesto el arranque entero -- la app quedaba sin catalogos, sin
  // pantallas y sin ningun mensaje. La base es una mejora (permite trabajar sin
  // senal), no un requisito para abrir.
  try {
    CAT = await DB.leerMeta('catalogos');
  } catch (e) {
    console.error('[db] no responde, se sigue contra la red', e);
    SIN_BASE = true;
    CAT = null;
  }
  if (!catalogoUsable(CAT)) CAT = null;

  // Envuelto: un cache viejo o a medias no puede impedir que despues se pida
  // el bueno por red. El pintado que falla es recuperable; no arrancar, no.
  if (CAT) {
    try { pintarCatalogos(); } catch (e) { console.error('[catalogos] cache inservible', e); CAT = null; }
  }

  try {
    const etag = SIN_BASE ? null : await DB.leerMeta('catalogos_etag').catch(() => null);
    const r = await fetch('api/catalogos', {
      credentials: 'same-origin',
      headers: etag ? { 'If-None-Match': etag } : {}
    });
    if (r.status === 304) return;
    if (!r.ok) return;
    CAT = await r.json();

    // Pintar PRIMERO y guardar despues. Al reves, si la base fallaba al
    // escribir, se saltaba a catch con los catalogos ya traidos y el formulario
    // sin armar: red bien, pantalla vacia.
    pintarCatalogos();
    guardarSuave(DB.guardarMeta('catalogos', CAT));
    guardarSuave(DB.guardarMeta('catalogos_etag', r.headers.get('ETag')));
  } catch (e) {
    if (!CAT) estado('Sin catálogos', 'malo');
  }

  if (SIN_BASE) {
    const el = $('#estado');
    estado('Sin memoria local', 'malo');
    el.title = 'Este navegador no deja guardar datos. Podés cargar con señal, pero lo que cargues sin conexión se pierde.';
  }
}

/**
 * El cache es una mejora, no parte del camino. Un fallo al escribir no puede
 * cortar nada: se anota que no hay base y se sigue.
 */
function guardarSuave(promesa) {
  return promesa.catch(() => { SIN_BASE = true; });
}

// `items` con respaldo a proposito: un catalogo incompleto tiene que dejar la
// app usable, no matarla.
function opciones(sel, items, etiqueta) {
  if (!sel) return;
  sel.innerHTML = (items || [])
    .map((i) => `<option value="${i.id}">${esc(etiqueta ? etiqueta(i) : i.nombre)}</option>`)
    .join('');
}

function pintarCatalogos() {
  if (!CAT) return;

  if (CAT.usuario) {
    $('#avatar').textContent = iniciales(CAT.usuario);
    $('#usuario').textContent = CAT.usuario.email || '';
    $('#c-auditor').textContent = 'Auditor: ' + (CAT.usuario.nombre || CAT.usuario.email || '—');
  }

  opciones($('[name=responsable_id]'), CAT.responsables, (r) => trafico(r));
  const vacio = '<option value="">—</option>';
  $('[name=controlador_id]').innerHTML = vacio +
    (CAT.controladores || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  $('[name=estado_control_id]').innerHTML = vacio +
    (CAT.estados_control || []).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');

  pintarFormulario();
}

// -------------------------------------------------------- ventana de datos

/**
 * Trae los ultimos DIAS_VENTANA dias de una sola vez. De aca salen el tablero
 * y la pantalla de hoy: son las mismas filas miradas de dos maneras.
 */
async function cargarVentana() {
  const desde = dia0(new Date());
  desde.setDate(desde.getDate() - (DIAS_VENTANA - 1));
  try {
    const d = await pedir(`api/inspecciones?desde=${desde.toISOString()}&limite=500`);
    VENTANA = d;
    // Sin await: guardar el cache no puede demorar ni romper el pintado.
    guardarSuave(DB.guardarCache('ventana', d));
    return true;
  } catch (e) {
    try {
      const c = await DB.leerCache('ventana');
      if (c) { VENTANA = c; estado('Datos guardados', 'aviso'); }
    } catch (e2) {
      SIN_BASE = true;
    }
    return false;
  }
}

const filasVentana = () => (VENTANA && VENTANA.inspecciones) || [];
const esNg = (i) => i.resultado === 'NG';
const nombresDesvio = (i) => (i.desvios || []).map((d) => d.nombre);

// ------------------------------------------------------------------- filas

function fila(i) {
  const ng = esNg(i);
  const tono = ng ? 'warn' : 'ok';
  const dv = nombresDesvio(i);
  const foto = (i.fotos || []).find((f) => f.ruta);
  const nf = (i.fotos || []).length;

  const mini = foto
    ? `<img src="uploads/${esc(foto.ruta)}" alt="" loading="lazy">`
    : `<small>${nf ? nf + (nf > 1 ? ' fotos' : ' foto') : 'sin foto'}</small>`;

  // La fila lleva al detalle DEL CONTROL, no al del equipo. Del equipo se sigue
  // llegando, pero desde adentro: tocar una fila y caer en el historial completo
  // del camion era saltearse lo que se acababa de tocar.
  VISTOS.set(i.uuid, i);

  return `
    <button type="button" class="fila" data-insp="${esc(i.uuid)}"
            style="border-left-color:${ng ? 'var(--ttfa-red)' : 'transparent'}">
      <span class="miniatura">${mini}</span>
      <span class="txt">
        <span class="cab">
          <span class="eq">${i.equipo ? esc(i.equipo.codigo) : 's/eq'}</span>
          <span class="badge ${tono}">${ng ? 'NG' : 'OK'}</span>
        </span>
        <span class="dv${ng ? '' : ' vacio'}">${dv.length ? esc(dv.join(' · ')) : 'Sin desvíos'}</span>
      </span>
      <span class="der">
        <small>${esc(trafico(i.responsable))}</small>
        <small class="mono">${hhmm(i.registrado_en)}</small>
      </span>
    </button>`;
}

/** Agrupa por turno y devuelve el HTML de los grupos con contenido. */
function grupos(items, etiqueta) {
  const mapa = new Map();
  items.forEach((i) => {
    const k = etiqueta(i);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(i);
  });
  return [...mapa.entries()].map(([k, arr]) => `
    <div class="grupo-cab">
      <b>${esc(k)}</b>
      <small>${arr.length} · ${arr.filter(esNg).length} NG</small>
    </div>
    ${arr.map(fila).join('')}`).join('');
}

// ----------------------------------------------------------------- tablero

function verTablero() {
  const filas = filasVentana();
  const nota = $('#t-nota');

  if (!filas.length) {
    $('#t-kpis').innerHTML = '';
    nota.textContent = VENTANA ? 'No hay controles en los últimos días.' : 'Sin conexión y nada guardado todavía.';
    return;
  }

  const hoyK = claveDia(new Date());
  const hoy = filas.filter((i) => claveDia(i.registrado_en) === hoyK);
  const hoyNg = hoy.filter(esNg);
  const ng = filas.filter(esNg);
  const dias = [...new Set(filas.map((i) => claveDia(i.registrado_en)))];
  const pctHoy = hoy.length ? Math.round((hoyNg.length / hoy.length) * 100) : 0;
  const pct = Math.round((ng.length / filas.length) * 100);
  const retira = ng.filter((i) => i.demora && i.demora.nombre === 'Se retira').length;
  const prom = Math.round(filas.length / (dias.length || 1));

  const kpi = (label, val, unidad, pie, tono) => `
    <div class="kpi ${tono || ''}">
      <span class="eq-label">${esc(label)}</span>
      <span class="k-val"><b>${val}</b>${unidad ? `<span>${esc(unidad)}</span>` : ''}</span>
      ${pie ? `<span class="k-pie">${esc(pie)}</span>` : ''}
    </div>`;

  $('#t-kpis').innerHTML =
    kpi('Controles hoy', hoy.length, '', 'prom. ' + prom + ' / jornada', '') +
    kpi('NG hoy', hoyNg.length, '', pctHoy + ' % de los controles', 'negative') +
    kpi(`Tasa NG ${dias.length} jornadas`, pct, '%', ng.length + ' desvíos', 'warn') +
    kpi('Unidades retiradas', retira, '', dias.length + ' jornadas', 'negative');

  // --- barras por jornada (las ultimas 8 con actividad)
  const porDia = new Map();
  filas.forEach((i) => {
    const k = claveDia(i.registrado_en);
    if (!porDia.has(k)) porDia.set(k, { n: 0, ng: 0 });
    const e = porDia.get(k);
    e.n++;
    if (esNg(i)) e.ng++;
  });
  const serie = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8);
  const tope = Math.max(1, ...serie.map(([, v]) => v.n));

  $('#t-series').innerHTML = serie.map(([k, v], n) => {
    const alto = Math.round((v.n / tope) * 86) + 2;
    const altoNg = Math.round((v.ng / tope) * 86);
    return `
      <div class="d${n === serie.length - 1 ? ' hoy' : ''}">
        <div class="caja" style="height:${alto}px"><div class="ng" style="height:${altoNg}px"></div></div>
        <small>${k.slice(8)}/${k.slice(5, 7)}</small>
      </div>`;
  }).join('');

  // --- desvios mas frecuentes
  const cuenta = {};
  ng.forEach((i) => nombresDesvio(i).forEach((d) => { cuenta[d] = (cuenta[d] || 0) + 1; }));
  const top = Object.entries(cuenta).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('#t-top').innerHTML = top.map(([n, c]) => `
    <div class="f"><span>${esc(n)}</span><b>${c}</b></div>`).join('')
    || '<p class="nota" style="padding:0">Sin desvíos cargados.</p>';

  // --- equipos con mas de un NG
  const porEq = {};
  ng.forEach((i) => {
    const eq = i.equipo ? i.equipo.codigo : null;
    if (!eq) return;
    if (!porEq[eq]) porEq[eq] = { n: 0, dv: nombresDesvio(i)[0] || 'Desvío' };
    porEq[eq].n++;
  });
  const reinc = Object.entries(porEq).filter(([, v]) => v.n > 1).sort((a, b) => b[1].n - a[1].n).slice(0, 4);
  $('#t-reinc-titulo').textContent = reinc.length
    ? `${reinc.length} equipos con más de un NG`
    : 'Ningún equipo repitió';
  $('#t-reinc').innerHTML = reinc.map(([eq, v]) => `
    <button type="button" class="f" data-eq="${esc(eq)}">
      <span class="eq">${esc(eq)}</span>
      <span class="dv">${esc(v.dv)}</span>
      <span class="n">${v.n} NG</span>
    </button>`).join('');

  nota.textContent = VENTANA && VENTANA.total > filas.length
    ? `Mostrando ${filas.length} de ${VENTANA.total} controles del período.`
    : '';
}

// --------------------------------------------------------------------- hoy

function verHoy() {
  const hoyK = claveDia(new Date());
  const hoy = filasVentana().filter((i) => claveDia(i.registrado_en) === hoyK);
  const ng = hoy.filter(esNg);
  const pct = hoy.length ? Math.round((ng.length / hoy.length) * 100) : 0;

  $('#h-meta').textContent = `${hoy.length} · ${ng.length} NG · ${pct} %`;
  $('#h-toggle').innerHTML = [['Todos', false], ['Solo NG', true]].map(([l, v]) =>
    `<button type="button" class="tag${soloNg === v ? ' sel' : ''}" data-ng="${v}">${l}</button>`).join('');

  const fuente = (soloNg ? ng : hoy).slice().sort((a, b) => new Date(a.registrado_en) - new Date(b.registrado_en));
  $('#h-lista').innerHTML = fuente.length
    ? grupos(fuente, (i) => turno(i.registrado_en))
    : `<p class="nota centro">${VENTANA ? 'Todavía no hay controles hoy.' : 'Sin conexión y nada guardado.'}</p>`;
}

// --------------------------------------------------------------- historial

async function verHistorial(reiniciar) {
  if (reiniciar) offsetHistorial = 0;

  // Dos filtros y no seis. Los cuatro chips de tipo de control se fueron con el
  // campo: filtraban por un dato que decia quien lo cargo. Ver YI-008.
  $('#f-chips').innerHTML = ['Todos', 'Solo NG'].map((n) =>
    `<button type="button" class="tag${filtro === n ? ' sel' : ''}" data-f="${esc(n)}">${esc(n)}</button>`).join('');

  const query = filtro === 'Solo NG' ? '&resultado=NG' : '';
  const url = `api/inspecciones?limite=50&offset=${offsetHistorial}${query}`;

  try {
    const d = await pedir(url);
    const cont = $('#f-lista');
    if (reiniciar) { cont.innerHTML = ''; vistosHistorial = 0; }

    // Ya no se filtra nada aca: los dos filtros que quedan los resuelve el
    // backend con `resultado`. Se acabo tambien el numero que mentia -- decia
    // "376 controles registrados" al lado de una lista de 7.
    const items = d.inspecciones;

    cont.insertAdjacentHTML('beforeend', grupos(items, (i) =>
      fmtDia(i.registrado_en) + ' · ' + turno(i.registrado_en).replace('Turno ', '')));

    offsetHistorial += d.inspecciones.length;
    vistosHistorial += items.length;
    const completo = offsetHistorial >= d.total;
    $('#mas').hidden = completo;

    $('#f-meta').textContent = filtro === 'Solo NG'
      ? `${d.total} NG`
      : `${d.total} controles registrados`;

    if (!vistosHistorial) {
      cont.innerHTML = '<p class="nota centro">Sin resultados con este filtro.</p>';
    }
  } catch (e) {
    $('#f-lista').innerHTML = '<p class="nota centro">Sin conexión. El historial completo necesita señal.</p>';
    $('#mas').hidden = true;
  }
}

// ----------------------------------------------------------------- detalle

/**
 * Detalle de un control puntual.
 *
 * Sale de `VISTOS`, no de la red: la fila que se toco ya tenia todo, y asi el
 * detalle abre sin senal.
 *
 * El boton de agregar observacion **crea un control nuevo**, no edita este. Es
 * a proposito: a la hora que se cargo, el equipo estaba OK, y eso fue cierto.
 * Ademas editar un registro ya sincronizado pedirìa un PUT con su propia
 * semantica offline y romperia la idempotencia por uuid de la cola. Ver YI-009.
 */
function verControl(uuid) {
  const i = VISTOS.get(uuid);
  if (!i) { irA(vistaPrevia); return; }

  const ng = esNg(i);
  const dv = nombresDesvio(i);
  const eq = i.equipo ? i.equipo.codigo : null;

  $('#titulo').textContent = eq ? 'Equipo ' + eq : 'Control';
  $('#eyebrow').textContent = `${fmtDia(i.registrado_en)} · ${hhmm(i.registrado_en)} · ${trafico(i.responsable)}`;
  $('#badge-cab').hidden = false;
  $('#badge-cab').innerHTML = ng
    ? '<span class="badge warn">NG</span>'
    : '<span class="badge ok">OK</span>';

  const fotos = (i.fotos || []).filter((f) => f.ruta);
  const dato = (k, v) => (v ? `<div class="d-fila"><span class="eq-label">${k}</span><span>${esc(v)}</span></div>` : '');

  // Todo en una caja. La observacion escrita a mano queda plegada detras de un
  // toque: casi siempre esta vacia, y cuando no, es un parrafo que empujaba los
  // datos del control fuera de pantalla. Va con <details> y no con JS, asi
  // funciona igual si algo mas falla.
  const ficha = `
      ${ng && dv.length
        ? `<div class="tags">${dv.map((d) => `<span class="tag sel">${esc(d)}</span>`).join('')}</div>`
        : '<p class="nota" style="padding:0 0 4px">Pasó sin observaciones.</p>'}
      <div class="datos">
        ${dato('Resolución', i.demora && i.demora.nombre)}
        ${dato('Auditor', nombreCorto(i.auditor))}
        ${dato('Controlador', i.controlador && i.controlador.nombre)}
        ${dato('Estado', i.estadoControl && i.estadoControl.nombre)}
      </div>`;

  $('#ctrl-cuerpo').innerHTML = `
    ${i.detalle ? `
      <details class="card ficha${ng ? ' acento' : ''}">
        <summary>
          ${ficha}
          <span class="ver-obs">${ico('chevron-left', 14)}Ver la observación</span>
        </summary>
        <p class="obs">${esc(i.detalle)}</p>
      </details>`
    : `<section class="card ficha${ng ? ' acento' : ''}">${ficha}</section>`}

    ${fotos.length ? `
      <div class="fotos" style="margin-top:14px">
        ${fotos.map((f) => `<div class="foto"><img src="uploads/${esc(f.ruta)}" alt="" loading="lazy"></div>`).join('')}
      </div>` : ''}

    <!-- Un control puede salir OK y que despues aparezca algo. No se edita este
         -- a esta hora estaba OK y eso fue cierto -- se carga uno nuevo. -->
    <button type="button" class="btn sec" id="ctrl-agregar" style="margin-top:16px">
      ${ico('plus', 16)} Agregar observación a este equipo
    </button>

    ${eq ? `
      <button type="button" class="btn sec" data-eq="${esc(eq)}" style="margin-top:10px">
        ${ico('file-text', 16)} Ver historial del equipo ${esc(eq)}
      </button>` : ''}`;

  $('#ctrl-agregar').dataset.eq = eq || '';
  $('#ctrl-agregar').dataset.resp = i.responsable ? i.responsable.id : '';
}

async function verDetalle(eq) {
  equipoDetalle = eq;
  $('#titulo').textContent = 'Equipo ' + eq;
  $('#eyebrow').textContent = 'Cargando…';
  $('#d-lineas').innerHTML = '';
  $('#d-recurrente').hidden = true;

  try {
    const [res, hist] = await Promise.all([
      pedir(`api/inspecciones/equipo/${encodeURIComponent(eq)}`),
      pedir(`api/inspecciones?equipo=${encodeURIComponent(eq)}&limite=200`)
    ]);
    const items = hist.inspecciones;
    const ultimo = items[0];

    $('#d-kpis').innerHTML = `
      <div class="kpi"><span class="eq-label">Controles</span><span class="k-val"><b>${res.total}</b></span></div>
      <div class="kpi negative"><span class="eq-label">NG</span><span class="k-val"><b>${res.ng}</b></span></div>
      <div class="kpi"><span class="eq-label">Tasa NG</span><span class="k-val"><b>${res.total ? Math.round((res.ng / res.total) * 100) : 0}</b><span>%</span></span></div>`;

    $('#eyebrow').textContent = ultimo
      ? `Tráfico ${trafico(ultimo.responsable)} · último ${fmtDia(ultimo.registrado_en).toLowerCase()}`
      : 'Sin registros';
    $('#badge-cab').hidden = false;
    $('#badge-cab').innerHTML = ultimo && esNg(ultimo)
      ? '<span class="badge risk">NG abierto</span>'
      : '<span class="badge ok">OK</span>';

    // Desvio que se repite: es lo que hace que valga la pena abrir el equipo.
    const cuenta = {};
    items.forEach((i) => nombresDesvio(i).forEach((d) => { cuenta[d] = (cuenta[d] || 0) + 1; }));
    const rec = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
    if (rec && rec[1] > 1) {
      $('#d-recurrente').hidden = false;
      $('#d-recurrente-txt').textContent = `${rec[0]} — ${rec[1]} veces en los últimos ${items.length} controles`;
    }

    $('#d-meta').textContent = items.length + ' registros';
    $('#d-lineas').innerHTML = items.map((i) => {
      const ng = esNg(i);
      const dv = nombresDesvio(i);
      return `
        <div class="linea">
          <span class="rail" style="background:${ng ? 'var(--ttfa-red)' : 'var(--status-ok)'}"></span>
          <div class="cuerpo">
            <div class="cab">
              <span class="fecha">${fmtDia(i.registrado_en)} · ${hhmm(i.registrado_en)}</span>
              <span class="badge sin-punto ${ng ? 'warn' : 'ok'}">${ng ? 'NG' : 'OK'}</span>
              <span class="tr">${esc(trafico(i.responsable))}</span>
            </div>
            <span class="dv">${dv.length ? esc(dv.join(' · ')) : 'Sin desvíos'}</span>
            ${i.demora ? `<span class="extra">Resolución: ${esc(i.demora.nombre)}</span>` : ''}
            ${i.detalle ? `<span class="extra">${esc(i.detalle)}</span>` : ''}
            <span class="extra">Cargó ${esc(nombreCorto(i.auditor))}</span>
          </div>
        </div>`;
    }).join('') || '<p class="nota">Sin registros.</p>';
  } catch (e) {
    $('#eyebrow').textContent = 'Sin conexión';
    $('#d-lineas').innerHTML = '<p class="nota">No se pudo traer el historial del equipo.</p>';
  }
}

// -------------------------------------------------------------- formulario

function pintarFormulario() {
  if (!CAT || !form) return;

  // --- resultado
  $('#c-seg').innerHTML = [['OK', 'circle-check'], ['NG', 'octagon-alert']].map(([v, i]) =>
    `<button type="button" data-v="${v}" class="${form.ng === (v === 'NG') ? 'sel' : ''}">${ico(i, 15)}${v}</button>`).join('');
  $('#c-ng').hidden = !form.ng;

  // --- zonas y desvios de la zona elegida
  const zonas = Zonas.repartir(CAT.desvios);
  if (form.zona >= zonas.length) form.zona = 0;
  const actual = zonas[form.zona] || { zona: '—', items: [] };

  $('#c-zonas').innerHTML = zonas.map((z, n) => {
    const marcados = z.items.filter((d) => form.desvios.has(d.id)).length;
    return `
      <button type="button" data-zona="${n}" class="${n === form.zona ? 'sel' : ''}">
        ${ico(z.icono, 15)}
        <span>${esc(z.zona)}</span>
        ${marcados ? `<span class="cuenta">${marcados}</span>` : ''}
      </button>`;
  }).join('');

  $('#c-zona-lbl').textContent = '2 · Desvío en ' + actual.zona.toLowerCase();
  const marcados = form.desvios.size;
  $('#c-zona-meta').textContent = marcados
    ? marcados + (marcados === 1 ? ' marcado' : ' marcados')
    : actual.items.length + ' opciones';

  $('#c-desvios').innerHTML = actual.items.map((d) => {
    const on = form.desvios.has(d.id);
    return `
      <button type="button" data-dv="${d.id}" class="${on ? 'sel' : ''}">
        <span class="caja">${on ? ico('check', 12) : ''}</span>
        <span>${esc(d.nombre)}</span>
      </button>`;
  }).join('') || '<p class="nota" style="padding:12px">Esta zona no tiene desvíos en el catálogo.</p>';

  // --- elegidos
  const elegidos = CAT.desvios.filter((d) => form.desvios.has(d.id))
    .map((d) => ({ txt: d.nombre, id: d.id }));
  $('#c-elegidos').hidden = !elegidos.length;
  $('#c-elegidos-tags').innerHTML = elegidos.map((e) => `
    <span class="tag sel">${esc(e.txt)}
      <button type="button" class="quitar" aria-label="Quitar"
        data-quitar="${e.id}">${ico('x', 12)}</button>
    </span>`).join('');

  // --- resolucion
  $('#c-demoras').innerHTML = (CAT.demoras || []).map((d) =>
    `<button type="button" class="tag${form.demora === d.nombre ? ' sel' : ''}" data-demora="${esc(d.nombre)}">${esc(d.nombre)}</button>`).join('');

  pintarPendientes();
  pintarFotos();

  // --- boton
  const n = elegidos.length;
  $('#c-guardar').textContent = form.ng
    ? (n ? `Registrar con ${n} ${n === 1 ? 'observación' : 'observaciones'}` : 'Registrar desvío')
    : 'Registrar control OK';
}

/**
 * Lo que quedo abierto en el control anterior de este equipo.
 *
 * Es el paso que el papel nunca tuvo: si la vez pasada el equipo salio NG, lo
 * primero es decir que paso con cada desvio. "Reincidio" lo vuelve a marcar
 * solo y salta a su zona, para no tener que buscarlo de nuevo en la lista.
 */
function pintarPendientes() {
  const p = form.pendientes;
  const caja = $('#c-pendientes');
  if (!p || !p.dv.length) {
    caja.hidden = true;
    $('#c-resultado').hidden = false;
    $('#c-guardar').disabled = false;
    $('#c-falta-resolver').hidden = true;
    return;
  }
  caja.hidden = false;

  $('#c-resol').innerHTML = p.dv.map((d) => {
    const r = form.resoluciones[d.nombre];
    return `
      <div class="f">
        <span class="mono">${fmtDia(p.fecha)}</span>
        <span class="nom">${esc(d.nombre)}</span>
        <span class="par">
          <button type="button" data-res="${esc(d.nombre)}" data-v="ok" class="${r === 'ok' ? 'sel' : ''}">OK</button>
          <button type="button" data-res="${esc(d.nombre)}" data-v="ng" class="${r === 'ng' ? 'sel' : ''}">NG</button>
        </span>
      </div>`;
  }).join('');

  // Hasta no resolver todo, no se pregunta el resultado: el resultado de este
  // control depende de lo que se conteste arriba. Y el boton queda bloqueado,
  // porque si no el paso se saltea sin querer y el NG anterior queda colgado
  // para siempre -- que es exactamente lo que este paso vino a evitar.
  const todo = p.dv.every((d) => form.resoluciones[d.nombre]);
  $('#c-resultado').hidden = !todo;
  $('#c-ng').hidden = !(todo && form.ng);
  $('#c-guardar').disabled = !todo;
  $('#c-falta-resolver').hidden = todo;
}

function pintarFotos() {
  const chk = form.checklist;
  // El checklist va PRIMERO: se pide en todos los controles, OK y NG, asi que
  // es el que siempre hay que sacar. "Agregar foto" es del desvio y solo
  // aparece cuando hay NG, asi que va despues.
  $('#c-fotos').innerHTML =
    `<button type="button" class="foto-add chk${chk ? ' puesta' : ''}" id="c-add-chk">
       ${ico(chk ? 'circle-check' : 'image', 18)}<span>Checklist batea</span>
     </button>` +
    form.fotos.map((f, i) => `
      <div class="foto">
        <img src="${f.url}" alt="">
        <button type="button" class="quitar" data-foto="${i}" aria-label="Quitar foto">${ico('x', 12)}</button>
      </div>`).join('') +
    (form.fotos.length < 5
      ? `<button type="button" class="foto-add" id="c-add">${ico('camera', 18)}<span>Agregar foto</span></button>`
      : '');

  const n = form.fotos.length + (chk ? 1 : 0);
  $('#c-fotos-meta').textContent = n + (n === 1 ? ' foto' : ' fotos');
}

/** Busca el ultimo control del equipo para saber si quedo algo abierto. */
/**
 * Abre el formulario ya cargado con el equipo y el trafico de un control que ya
 * existe. Se usa cuando un control salio OK y despues aparecio algo.
 *
 * Arranca en NG: si se viene de "agregar observacion", no hay otra razon.
 */
function precargarEquipo(codigo, responsableId) {
  if (!codigo) return;
  const f = $('#form');
  f.equipo_codigo.value = codigo;
  if (responsableId) f.responsable_id.value = responsableId;
  form.ng = true;
  pintarFormulario();
  mirarEquipo(codigo);
  f.equipo_codigo.blur();
}

async function mirarEquipo(codigo) {
  form.pendientes = null;
  form.resoluciones = {};
  if (!codigo || String(codigo).length < 2) { pintarPendientes(); return; }

  try {
    const d = await pedir(`api/inspecciones?equipo=${encodeURIComponent(codigo)}&limite=1`);
    const u = d.inspecciones[0];
    if (u && esNg(u) && (u.desvios || []).length) {
      form.pendientes = { fecha: u.registrado_en, dv: u.desvios };
    }
  } catch (e) {
    // Sin senal no se puede saber: se sigue como control nuevo, sin bloquear.
  }
  pintarPendientes();
}

// ----------------------------------------------------------------- guardar

async function guardar(e) {
  e.preventDefault();
  const f = e.target;
  const codigo = Number(f.equipo_codigo.value);

  if (!codigo) { toast('Falta el equipo', 'Poné el número del camión.', true); return; }
  if (form.ng && !form.desvios.size) {
    toast('Falta el desvío', 'Un NG necesita al menos una observación.', true);
    return;
  }

  const btn = $('#c-guardar');
  const etiqueta = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const fotos = [];
    for (const x of form.fotos) {
      fotos.push({ blob: await Camara.comprimir(x.file), orientacion: 'libre' });
    }

    const demora = (CAT.demoras || []).find((d) => d.nombre === form.demora);

    await Sync.encolar({
      responsable_id: Number(f.responsable_id.value),
      equipo_codigo: codigo,
      resultado: form.ng ? 'NG' : 'OK',
      // Ya no viaja `tipo_desvio_id`: lo deriva el servidor del desvio, que es
      // lo unico que lo determina. Ver YI-008.
      desvio_ids: form.ng ? [...form.desvios] : [],
      demora_id: form.ng && demora ? demora.id : null,
      detalle: f.detalle.value.trim() || null,
      controlador_id: f.controlador_id.value ? Number(f.controlador_id.value) : null,
      estado_control_id: f.estado_control_id.value ? Number(f.estado_control_id.value) : null,
      fotos,
      foto_checklist: form.checklist ? await Camara.comprimir(form.checklist.file) : null
    });

    toast('Control registrado', `Equipo ${codigo} · ${form.ng ? 'NG' : 'sin desvíos'}`);

    // Se limpia todo menos el trafico: el inspector recorre una fila entera
    // del mismo trafico y volver a elegirlo en cada camion es un toque de mas.
    form.fotos.forEach((x) => URL.revokeObjectURL(x.url));
    if (form.checklist) URL.revokeObjectURL(form.checklist.url);
    const traficoElegido = f.responsable_id.value;
    f.reset();
    f.responsable_id.value = traficoElegido;
    form = formVacio();
    pintarFormulario();
    f.equipo_codigo.focus();

    cargarVentana().then(() => { if (vista === 'hoy') verHoy(); if (vista === 'tablero') verTablero(); });
  } catch (err) {
    toast('No se pudo guardar', err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = etiqueta;
  }
}

// -------------------------------------------------------------- navegacion

const PANTALLAS = {
  tablero:   { titulo: 'Tablero',           eyebrow: 'Cómo viene la jornada',    icono: 'gauge' },
  hoy:       { titulo: 'Patrulla de hoy',   eyebrow: 'Controles de la jornada',  icono: 'clipboard-check' },
  historial: { titulo: 'Historial completo', eyebrow: 'Calidad · Seguridad · 5s', icono: 'file-text' },
  cargar:    { titulo: 'Nuevo control',     eyebrow: 'Patrulla de playa',        icono: 'plus' }
};

function irA(nombre) {
  if (nombre !== 'detalle' && nombre !== 'control') vistaPrevia = nombre;
  vista = nombre;
  cerrarDrawer();

  $$('.vista').forEach((v) => { v.hidden = v.id !== 'v-' + nombre; });
  $('#scroll').scrollTop = 0;

  const esDetalle = nombre === 'detalle' || nombre === 'control';
  $('#menu').hidden = esDetalle;
  $('#volver').hidden = !esDetalle;
  $('#refrescar').hidden = esDetalle;
  $('#badge-cab').hidden = true;

  $$('.tab').forEach((t) => t.classList.toggle('activo', t.dataset.v === vistaPrevia));

  if (!esDetalle) {
    const p = PANTALLAS[nombre];
    $('#titulo').textContent = p.titulo;
    $('#eyebrow').textContent = p.eyebrow;
  }

  // Se recarga al entrar, no una sola vez: el otro inspector pudo cargar algo
  // mientras estabas en otra pantalla.
  if (nombre === 'tablero') { cargarVentana().then(verTablero); verTablero(); }
  if (nombre === 'hoy') { cargarVentana().then(verHoy); verHoy(); }
  if (nombre === 'historial') verHistorial(true);
  if (nombre === 'cargar') pintarFormulario();
}

function abrirDrawer() { $('#drawer').hidden = false; $('#scrim').hidden = false; }
function cerrarDrawer() { $('#drawer').hidden = true; $('#scrim').hidden = true; }

function pintarNavegacion() {
  $('#tabs').innerHTML = Object.entries(PANTALLAS).map(([k, p]) => `
    <button type="button" class="tab${vista === k ? ' activo' : ''}" data-v="${k}">
      ${ico(p.icono, 20)}<span>${k === 'hoy' ? 'Hoy' : k === 'cargar' ? 'Cargar' : p.titulo.split(' ')[0]}</span>
    </button>`).join('');

  // Un solo item: es el unico modulo que hay. Los cuatro que estaban aca eran
  // los mismos cuatro de la barra de abajo, asi que el cajon no llevaba a
  // ningun lado nuevo -- solo repetia, y con el pulgar mas lejos. Moverse entre
  // pantallas se hace abajo; el cajon queda para el tema y el usuario.
  $('#drawer-nav').innerHTML =
    `<span class="it activo">${ico('truck', 17)}<span>Control de equipo</span></span>`;

  $('#menu').innerHTML = ico('menu', 20);
  $('#volver').innerHTML = ico('chevron-left', 20);
  $('#refrescar').innerHTML = ico('rotate-cw', 16);
}

// -------------------------------------------------------------------- eventos

document.addEventListener('click', (e) => {
  const t = e.target;

  // abrir el detalle de un equipo desde cualquier fila
  const filaCtrl = t.closest('[data-insp]');
  if (filaCtrl) { irA('control'); verControl(filaCtrl.dataset.insp); return; }

  // Agregar observacion: abre el formulario precargado con ese equipo. Es un
  // control NUEVO, no una edicion del anterior.
  const agregar = t.closest('#ctrl-agregar');
  if (agregar) { irA('cargar'); precargarEquipo(agregar.dataset.eq, agregar.dataset.resp); return; }

  const filaEq = t.closest('[data-eq]');
  if (filaEq && filaEq.dataset.eq) { irA('detalle'); verDetalle(filaEq.dataset.eq); return; }

  const tab = t.closest('.tab');
  if (tab) { irA(tab.dataset.v); return; }

  const tgl = t.closest('[data-ng]');
  if (tgl) { soloNg = tgl.dataset.ng === 'true'; verHoy(); return; }

  const chip = t.closest('[data-f]');
  if (chip) { filtro = chip.dataset.f; verHistorial(true); return; }

  // ---- formulario
  const seg = t.closest('#c-seg button');
  if (seg) { form.ng = seg.dataset.v === 'NG'; pintarFormulario(); return; }

  const zona = t.closest('[data-zona]');
  if (zona) { form.zona = Number(zona.dataset.zona); pintarFormulario(); return; }

  const dv = t.closest('[data-dv]');
  if (dv) {
    const id = Number(dv.dataset.dv);
    if (form.desvios.has(id)) form.desvios.delete(id); else form.desvios.add(id);
    pintarFormulario();
    return;
  }

  const quitar = t.closest('[data-quitar]');
  if (quitar) { form.desvios.delete(Number(quitar.dataset.quitar)); pintarFormulario(); return; }


  const dem = t.closest('[data-demora]');
  if (dem) { form.demora = dem.dataset.demora; pintarFormulario(); return; }

  const res = t.closest('[data-res]');
  if (res) {
    const nombre = res.dataset.res;
    form.resoluciones[nombre] = res.dataset.v;
    if (res.dataset.v === 'ng') {
      // Reincidio: se vuelve a marcar solo y la vista salta a su zona.
      const d = (CAT.desvios || []).find((x) => x.nombre === nombre);
      if (d) {
        form.desvios.add(d.id);
        form.ng = true;
        const zonas = Zonas.repartir(CAT.desvios);
        const n = zonas.findIndex((z) => z.items.some((x) => x.id === d.id));
        if (n >= 0) form.zona = n;
      }
    }
    pintarFormulario();
    return;
  }

  const quitarFoto = t.closest('[data-foto]');
  if (quitarFoto) {
    const i = Number(quitarFoto.dataset.foto);
    URL.revokeObjectURL(form.fotos[i].url);
    form.fotos.splice(i, 1);
    pintarFotos();
    return;
  }

  if (t.closest('#c-add')) { $('#c-file').click(); return; }
  if (t.closest('#c-add-chk')) { $('#c-file-chk').click(); return; }
});

$('#menu').addEventListener('click', abrirDrawer);
$('#scrim').addEventListener('click', cerrarDrawer);
$('#volver').addEventListener('click', () => irA(vistaPrevia));
$('#tema').addEventListener('click', () =>
  aplicarTema(document.documentElement.getAttribute('data-tema') !== 'claro'));

$('#refrescar').addEventListener('click', () => {
  if (vista === 'historial') verHistorial(true);
  else cargarVentana().then(() => (vista === 'tablero' ? verTablero() : verHoy()));
});

$('#mas').addEventListener('click', () => verHistorial(false));
$('#form').addEventListener('submit', guardar);

$('[name=equipo_codigo]').addEventListener('change', (e) => mirarEquipo(e.target.value.trim()));


async function tomarFoto(input, destino) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  if (destino === 'chk') {
    if (form.checklist) URL.revokeObjectURL(form.checklist.url);
    form.checklist = { file, url };
  } else {
    form.fotos.push({ file, url });
  }
  pintarFotos();
}
$('#c-file').addEventListener('change', (e) => tomarFoto(e.target, 'foto'));
$('#c-file-chk').addEventListener('change', (e) => tomarFoto(e.target, 'chk'));

Sync.alCambiar((s) => {
  if (s.tipo === 'sincronizando') estado('Sincronizando…', 'aviso');
  else if (s.tipo === 'sin_base') {
    // No hay donde encolar. Es lo mas grave que le puede pasar a esta app y
    // tiene que decirlo, porque cambia como se puede trabajar: solo con senal.
    SIN_BASE = true;
    estado('Sin memoria local', 'malo');
    $('#estado').title = 'Este navegador no deja guardar datos. Podés cargar con señal, pero lo que cargues sin conexión se pierde.';
  } else if (s.tipo === 'sin_conexion') estado(`Sin señal · ${s.pendientes || 0}`, 'aviso');
  else if (s.tipo === 'sesion_vencida') estado('Sesión vencida', 'malo');
  else if (s.tipo === 'encolada') estado(`En cola · ${s.pendientes}`, 'aviso');
  else if (s.tipo === 'listo') {
    if (s.pendientes) estado(`${s.pendientes} pendiente(s)`, 'aviso');
    else { estado('Al día', 'bueno'); setTimeout(() => estado(null), 2500); }
    if (s.enviadas) cargarVentana().then(() => { if (vista === 'hoy') verHoy(); if (vista === 'tablero') verTablero(); });
  }
});

// -------------------------------------------------------------------- arranque

form = formVacio();
aplicarTema(document.documentElement.getAttribute('data-tema') === 'claro');
pintarNavegacion();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

cargarCatalogos().then(() => {
  irA('hoy');
  Sync.sincronizar();
});
