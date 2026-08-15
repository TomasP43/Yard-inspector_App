'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let CAT = null;              // catalogos
let seleccionados = new Set(); // desvios elegidos en el formulario
let nuevosDesvios = [];        // desvios escritos a mano que no estaban en la lista
let offsetHistorial = 0;

// ---------------------------------------------------------------- utilidades

function fmtFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function estado(texto, clase) {
  const el = $('#estado');
  if (!texto) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = texto;
  el.className = 'estado ' + (clase || '');
}

async function pedir(url) {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (r.status === 401) { estado('Sesión vencida — volvé a entrar', 'malo'); throw new Error('401'); }
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}

// ---------------------------------------------------------------- catalogos

async function cargarCatalogos() {
  // Primero lo cacheado: la app tiene que poder abrir el formulario sin senal.
  CAT = await DB.leerMeta('catalogos');
  if (CAT) pintarCatalogos();

  try {
    const etag = await DB.leerMeta('catalogos_etag');
    const r = await fetch('api/catalogos', {
      credentials: 'same-origin',
      headers: etag ? { 'If-None-Match': etag } : {}
    });
    if (r.status === 304) return;
    if (!r.ok) return;
    CAT = await r.json();
    await DB.guardarMeta('catalogos', CAT);
    await DB.guardarMeta('catalogos_etag', r.headers.get('ETag'));
    pintarCatalogos();
  } catch (e) {
    if (!CAT) estado('Sin catálogos y sin conexión', 'malo');
  }
}

function opciones(sel, items, vacio) {
  sel.innerHTML = (vacio ? '<option value="">—</option>' : '') +
    items.map((i) => `<option value="${i.id}">${i.nombre}</option>`).join('');
}

/**
 * Iniciales para el avatar, mismo criterio que la intranet ("TP").
 * Con nombre: primera letra de las dos primeras palabras.
 * Sin nombre: las dos primeras letras del usuario del email, que para
 * tpozo@ttfasa.com da "TP" y no "TT" (que es lo que saldria si se partiera
 * el email por el arroba).
 */
function iniciales(u) {
  if (!u) return '';
  const nombre = (u.nombre || '').trim();
  if (nombre) {
    const p = nombre.split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  const local = (u.email || '').split('@')[0];
  return local.slice(0, 2).toUpperCase();
}

function pintarCatalogos() {
  if (!CAT) return;

  const av = $('#avatar');
  if (CAT.usuario) {
    av.textContent = iniciales(CAT.usuario);
    av.title = CAT.usuario.email;
  }
  opciones($('[name=responsable_id]'), CAT.responsables, false);
  opciones($('[name=tipo_desvio_id]'), CAT.tipos_desvio, false);
  opciones($('[name=demora_id]'), CAT.demoras, true);
  opciones($('[name=controlador_id]'), CAT.controladores, true);
  opciones($('[name=estado_control_id]'), CAT.estados_control, true);

  $('#desvios').innerHTML = CAT.desvios
    .map((d) => `<button type="button" class="chip" data-id="${d.id}" data-tipo="${d.tipo_desvio_id || ''}" data-detalle="${d.requiere_detalle ? 1 : 0}">${d.nombre}</button>`)
    .join('');

  $('#equipos').innerHTML = (CAT.equipos || []).map((c) => `<option value="${c}">`).join('');
}

// ------------------------------------------------------------------ listados

function tarjeta(i) {
  const desvios = (i.desvios || []).map((d) => d.nombre).join(', ');
  const foto = (i.fotos || []).find((f) => f.ruta);
  const img = foto
    ? `<img src="uploads/${foto.ruta}" alt="" loading="lazy">`
    : `<div class="sin-foto" title="La foto está en Drive, todavía no se copió">—</div>`;
  return `
    <article class="item ${i.resultado === 'NG' ? 'ng' : 'ok'}">
      ${img}
      <div class="item-txt">
        <div class="item-cab">
          <strong>${i.equipo ? i.equipo.codigo : 's/equipo'}</strong>
          <span class="chip-res">${i.resultado}</span>
          <small>${fmtFecha(i.registrado_en)}</small>
        </div>
        <div class="item-desvio">${desvios || '<em>sin desvíos</em>'}</div>
        <small class="item-pie">${i.responsable ? i.responsable.nombre : ''}</small>
      </div>
    </article>`;
}

function pintarLista(cont, items, vacio) {
  cont.innerHTML = items.length
    ? items.map(tarjeta).join('')
    : `<p class="nota">${vacio}</p>`;
}

async function verHoy() {
  try {
    const d = await pedir('api/inspecciones/hoy');
    await DB.guardarCache('hoy', d.inspecciones);
    pintarLista($('#lista-hoy'), d.inspecciones, 'Todavía no hay desvíos cargados hoy.');
  } catch (e) {
    const c = await DB.leerCache('hoy');
    pintarLista($('#lista-hoy'), c || [], 'Sin conexión y nada guardado.');
    if (c) estado('Mostrando datos guardados', 'aviso');
  }
}

async function verHistorial(reiniciar) {
  if (reiniciar) offsetHistorial = 0;
  const res = $('#f-resultado').value;
  const url = `api/inspecciones?limite=50&offset=${offsetHistorial}` + (res ? `&resultado=${res}` : '');
  try {
    const d = await pedir(url);
    const cont = $('#lista-historial');
    if (reiniciar) cont.innerHTML = '';
    cont.insertAdjacentHTML('beforeend', d.inspecciones.map(tarjeta).join(''));
    offsetHistorial += d.inspecciones.length;
    $('#mas').hidden = offsetHistorial >= d.total;
    if (!d.total) cont.innerHTML = '<p class="nota">Sin resultados.</p>';
  } catch (e) {
    $('#lista-historial').innerHTML = '<p class="nota">Sin conexión.</p>';
  }
}

async function verCamion() {
  const cod = $('#f-equipo').value.trim();
  if (!cod) return;
  try {
    const [resumen, hist] = await Promise.all([
      pedir(`api/inspecciones/equipo/${cod}`),
      pedir(`api/inspecciones?equipo=${cod}&limite=200`)
    ]);
    $('#resumen-camion').hidden = false;
    $('#resumen-camion').innerHTML = `
      <div><b>${resumen.total}</b><span>patrullas</span></div>
      <div class="malo"><b>${resumen.ng}</b><span>NG</span></div>
      <div class="bueno"><b>${resumen.ok}</b><span>OK</span></div>`;
    pintarLista($('#lista-camion'), hist.inspecciones, 'Sin registros.');
  } catch (e) {
    $('#resumen-camion').hidden = true;
    $('#lista-camion').innerHTML = '<p class="nota">No se encontró el camión o no hay conexión.</p>';
  }
}

// ---------------------------------------------------------------- formulario

function abrirForm() {
  seleccionados.clear();
  nuevosDesvios = [];
  pintarNuevos();
  cerrarCajaNuevo();
  $('#form').reset();
  $$('#desvios .chip').forEach((c) => c.classList.remove('sel'));
  $('#lbl-detalle').hidden = true;
  $('[name=detalle]').required = false;
  // Imprescindible: reset() vuelve el resultado a OK pero NO toca los `required`
  // que pusimos por JS. Si quedan activos dentro del bloque NG oculto, el
  // navegador bloquea el submit sin mostrar nada y la app se queda muda.
  alCambiarResultado();
  $('#modal').hidden = false;
}

function cerrarForm() { $('#modal').hidden = true; }

function alCambiarResultado() {
  const ng = $('[name=resultado]:checked').value === 'NG';
  $('#bloque-ng').hidden = !ng;
  $('#foto1').required = ng;
  $('[name=tipo_desvio_id]').required = ng;
}

function alTocarChip(e) {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const id = Number(chip.dataset.id);
  if (seleccionados.has(id)) { seleccionados.delete(id); chip.classList.remove('sel'); }
  else {
    seleccionados.add(id);
    chip.classList.add('sel');
    // El tipo se prellena con el dominante del desvio, pero queda editable.
    if (chip.dataset.tipo && seleccionados.size === 1) {
      $('[name=tipo_desvio_id]').value = chip.dataset.tipo;
    }
  }
  const exige = $$('.chip.sel').some((c) => c.dataset.detalle === '1');
  $('#lbl-detalle').hidden = !exige;
  $('[name=detalle]').required = exige;
}

// ------------------------------------------------- desvios fuera del catalogo

/**
 * El inspector puede agregar un desvio que no esta en la lista, pero antes se
 * le muestran los parecidos. La comprobacion corre contra el catalogo cacheado
 * en IndexedDB, no contra el servidor: esto se usa sin senal.
 *
 * El desvio no se crea acá. Viaja como texto junto a la inspeccion y lo
 * resuelve el servidor al sincronizar, que es el unico que puede decidir si
 * ya existe. Crearlo antes dejaria basura en el catalogo si la inspeccion
 * despues se descarta.
 */
function pintarNuevos() {
  $('#nuevos').innerHTML = nuevosDesvios
    .map((n, i) => `<button type="button" class="chip sel chip-nuevo" data-i="${i}">${n} <span aria-hidden="true">&times;</span></button>`)
    .join('');
}

function cerrarCajaNuevo() {
  $('#nuevo-box').hidden = true;
  $('#nuevo-nombre').value = '';
  $('#sugerencias').innerHTML = '';
}

function revisarParecidos() {
  const texto = $('#nuevo-nombre').value.trim();
  const cont = $('#sugerencias');
  if (texto.length < 3 || !CAT) { cont.innerHTML = ''; return; }

  const ya = Similitud.exacto(texto, CAT.desvios);
  if (ya) {
    cont.innerHTML = `<p class="aviso-sim">Ya existe como <b>${ya.nombre}</b>.</p>
      <button type="button" class="chip" data-usar="${ya.id}">Usar ese</button>`;
    return;
  }

  const cerca = Similitud.similares(texto, CAT.desvios);
  if (!cerca.length) { cont.innerHTML = '<p class="aviso-sim ok">No hay ninguno parecido.</p>'; return; }

  cont.innerHTML = '<p class="aviso-sim">¿No será alguno de estos?</p>' +
    cerca.map((d) => `<button type="button" class="chip" data-usar="${d.id}">${d.nombre}</button>`).join('');
}

let tSugerencias = null;
$('#add-desvio').addEventListener('click', () => {
  $('#nuevo-box').hidden = false;
  $('#nuevo-nombre').focus();
});
$('#nuevo-cancelar').addEventListener('click', cerrarCajaNuevo);
$('#nuevo-nombre').addEventListener('input', () => {
  clearTimeout(tSugerencias);
  tSugerencias = setTimeout(revisarParecidos, 250);
});

// Elegir una sugerencia marca el desvio existente en vez de crear uno nuevo.
$('#sugerencias').addEventListener('click', (e) => {
  const b = e.target.closest('[data-usar]');
  if (!b) return;
  const id = Number(b.dataset.usar);
  seleccionados.add(id);
  const chip = $(`.chip[data-id="${id}"]`);
  if (chip) chip.classList.add('sel');
  cerrarCajaNuevo();
});

$('#nuevo-ok').addEventListener('click', () => {
  const texto = $('#nuevo-nombre').value.replace(/\s+/g, ' ').trim();
  if (texto.length < 3) { alert('Escribí al menos 3 caracteres.'); return; }

  // Coincidencia exacta: se usa el que ya existe, sin crear un duplicado.
  const ya = CAT && Similitud.exacto(texto, CAT.desvios);
  if (ya) {
    seleccionados.add(ya.id);
    const chip = $(`.chip[data-id="${ya.id}"]`);
    if (chip) chip.classList.add('sel');
    cerrarCajaNuevo();
    return;
  }
  if (nuevosDesvios.some((n) => Similitud.normalizar(n) === Similitud.normalizar(texto))) {
    cerrarCajaNuevo();
    return;
  }
  if (nuevosDesvios.length >= 5) { alert('Máximo 5 desvíos nuevos por inspección.'); return; }

  nuevosDesvios.push(texto);
  pintarNuevos();
  cerrarCajaNuevo();
});

$('#nuevos').addEventListener('click', (e) => {
  const b = e.target.closest('.chip-nuevo');
  if (!b) return;
  nuevosDesvios.splice(Number(b.dataset.i), 1);
  pintarNuevos();
});

async function guardar(e) {
  e.preventDefault();
  const f = e.target;
  const ng = f.resultado.value === 'NG';

  if (ng && seleccionados.size === 0 && nuevosDesvios.length === 0) {
    alert('Elegí al menos un desvío.');
    return;
  }

  const btn = $('.link.fuerte');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const fotos = [];
    const f1 = $('#foto1').files[0];
    const f3 = $('#foto3').files[0];
    if (ng && f1) fotos.push({ blob: await Camara.comprimir(f1), orientacion: 'horizontal' });
    if (ng && f3) fotos.push({ blob: await Camara.comprimir(f3), orientacion: 'libre' });

    const fchk = $('#foto-checklist').files[0];

    await Sync.encolar({
      responsable_id: Number(f.responsable_id.value),
      equipo_codigo: Number(f.equipo_codigo.value),
      resultado: f.resultado.value,
      tipo_desvio_id: ng ? Number(f.tipo_desvio_id.value) : null,
      desvio_ids: ng ? Array.from(seleccionados) : [],
      desvios_nuevos: ng ? nuevosDesvios.slice() : [],
      demora_id: ng && f.demora_id.value ? Number(f.demora_id.value) : null,
      detalle: ng ? f.detalle.value.trim() : null,
      controlador_id: f.controlador_id.value ? Number(f.controlador_id.value) : null,
      estado_control_id: f.estado_control_id.value ? Number(f.estado_control_id.value) : null,
      fotos,
      foto_checklist: fchk ? await Camara.comprimir(fchk) : null
    });

    cerrarForm();
    verHoy();
  } catch (err) {
    alert('No se pudo guardar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// ---------------------------------------------------------------------- tema

/**
 * El default es el oscuro de la intranet; el claro existe porque esto se usa
 * en la playa, al sol. La eleccion se guarda en localStorage y la aplica el
 * script inline del <head> antes de pintar, para que no haya parpadeo.
 *
 * No sigue a prefers-color-scheme: el celular puede estar en modo oscuro y
 * aun asi el inspector necesitar la pantalla clara porque esta al sol. Manda
 * el boton, no el sistema.
 */
function aplicarTema(claro) {
  const raiz = document.documentElement;
  if (claro) raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');

  $('#tema').setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  // que la barra de estado del celular acompane al tema
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', claro ? '#f4f5f7' : '#0a0a0b');
  try { localStorage.setItem('yard-tema', claro ? 'claro' : 'oscuro'); } catch (e) { /* modo privado */ }
}

$('#tema').addEventListener('click', () => {
  aplicarTema(document.documentElement.getAttribute('data-tema') !== 'claro');
});

// El script del <head> ya puso el tema, pero no la etiqueta del boton ni el
// theme-color. Sin esto, quien vuelve en modo claro ve un boton que dice
// "cambiar a modo claro" estando ya en claro.
aplicarTema(document.documentElement.getAttribute('data-tema') === 'claro');

// ------------------------------------------------------------------- arranque

function cambiarVista(nombre) {
  $$('.tab').forEach((t) => t.classList.toggle('activo', t.dataset.vista === nombre));
  $$('.vista').forEach((v) => { v.hidden = v.id !== 'v-' + nombre; });
  if (nombre === 'hoy') verHoy();
  if (nombre === 'historial') verHistorial(true);
}

Sync.alCambiar((s) => {
  if (s.tipo === 'sincronizando') estado('Sincronizando…', 'aviso');
  else if (s.tipo === 'sin_conexion') estado(`Sin conexión — ${s.pendientes || 0} pendiente(s)`, 'aviso');
  else if (s.tipo === 'sesion_vencida') estado('Sesión vencida — entrá de nuevo, no se perdió nada', 'malo');
  else if (s.tipo === 'encolada') estado(`Guardada — ${s.pendientes} pendiente(s)`, 'aviso');
  else if (s.tipo === 'listo') {
    if (s.pendientes) estado(`${s.pendientes} pendiente(s)`, 'aviso');
    else { estado('Todo sincronizado', 'bueno'); setTimeout(() => estado(null), 3000); }
    if (s.enviadas) verHoy();
  }
});

$$('.tab').forEach((t) => t.addEventListener('click', () => cambiarVista(t.dataset.vista)));
$('#nueva').addEventListener('click', abrirForm);
$('#cancelar').addEventListener('click', cerrarForm);
$('#form').addEventListener('submit', guardar);
$$('[name=resultado]').forEach((r) => r.addEventListener('change', alCambiarResultado));
$('#desvios').addEventListener('click', alTocarChip);
$('#buscar').addEventListener('click', verCamion);
$('#f-equipo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verCamion(); } });
$('#f-resultado').addEventListener('change', () => verHistorial(true));
$('#mas').addEventListener('click', () => verHistorial(false));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

cargarCatalogos().then(() => { verHoy(); Sync.sincronizar(); });
