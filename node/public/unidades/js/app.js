'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let CAT = null;
let VIAJE = null;      // viaje abierto
let ETAPA = null;      // etapa seleccionada
let UNIDAD = null;     // unidad en edicion
let DANOS = [];        // danos acumulados de la unidad actual
let DANO = null;       // dano en edicion

// ------------------------------------------------------------- utilidades

const fmtFecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

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

function vista(cual) {
  $('#v-viajes').hidden = cual !== 'viajes';
  $('#v-unidades').hidden = cual !== 'unidades';
}

// ------------------------------------------------------------- catalogos

function iniciales(u) {
  if (!u) return '';
  const n = (u.nombre || '').trim();
  if (n) {
    const p = n.split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  return (u.email || '').split('@')[0].slice(0, 2).toUpperCase();
}

async function cargarCatalogos() {
  CAT = await DBU.leerMeta('catalogos');
  if (CAT) pintarCatalogos();

  try {
    const etag = await DBU.leerMeta('catalogos_etag');
    const r = await fetch('../api/unidades/catalogos', {
      credentials: 'same-origin',
      headers: etag ? { 'If-None-Match': etag } : {}
    });
    if (r.status === 304 || !r.ok) return;
    CAT = await r.json();
    await DBU.guardarMeta('catalogos', CAT);
    await DBU.guardarMeta('catalogos_etag', r.headers.get('ETag'));
    pintarCatalogos();
  } catch (e) {
    if (!CAT) estado('Sin catálogos y sin conexión', 'malo');
  }
}

function pintarCatalogos() {
  if (!CAT) return;

  const av = $('#avatar');
  if (CAT.usuario) { av.textContent = iniciales(CAT.usuario); av.title = CAT.usuario.email; }

  $('#f-playa').innerHTML = '<option value="">Todas las playas</option>' +
    (CAT.playas || []).map((p) => `<option value="${p.codigo}">${p.nombre}</option>`).join('');

  $('#detalles').innerHTML = (CAT.detalles_dano || [])
    .map((d) => `<option value="${d.nombre}">`).join('');

  // Formulario de carga manual
  $('[name=playa]').innerHTML = (CAT.playas || [])
    .map((p) => `<option value="${p.codigo}">${p.nombre}</option>`).join('');
  $('[name=flujo]').innerHTML = (CAT.flujos || [])
    .map((f) => `<option value="${f.nombre}">${f.nombre}</option>`).join('');
}

// -------------------------------------------------- carga manual de un viaje

/**
 * Una linea por unidad: `VIN` o `VIN, modelo, destino`.
 *
 * Se acepta pegar directo desde una planilla, que es como llega la lista en
 * las playas sin integracion. El VIN se normaliza a mayusculas porque el
 * servidor deduplica por VIN dentro del viaje.
 */
function parsearUnidades(texto) {
  return String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linea, i) => {
      const p = linea.split(',').map((x) => x.trim());
      return {
        vin: (p[0] || '').toUpperCase(),
        modelo: p[1] || null,
        destino: p[2] || null,
        secuencia: i + 1,
        orden_bajada: i + 1
      };
    })
    .filter((u) => u.vin);
}

function abrirFormViaje() {
  const f = $('#form-viaje');
  f.reset();
  f.fecha.value = new Date().toISOString().slice(0, 10);
  $('#viaje-conteo').textContent = '';
  $('#modal-viaje').hidden = false;
}

async function crearViaje(e) {
  e.preventDefault();
  const f = e.target;
  const unidades = parsearUnidades(f.unidades.value);
  if (!unidades.length) { alert('Cargá al menos un VIN.'); return; }

  const btn = f.querySelector('.link.fuerte');
  btn.disabled = true;
  btn.textContent = 'Creando…';

  try {
    const r = await fetch('../api/unidades/viajes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        playa: f.playa.value,
        flujo: f.flujo.value,
        fecha: f.fecha.value,
        equipo_codigo: f.equipo.value ? Number(f.equipo.value) : null,
        referencia_externa: f.referencia.value.trim() || null,
        unidades
      })
    });

    const d = await r.json();
    if (!r.ok) {
      alert('No se pudo crear: ' + (d.error || r.status) + (d.detalle ? '\n' + d.detalle : ''));
      return;
    }

    // Los avisos no son errores, pero alguien los tiene que ver: modelos o
    // destinos fuera del catalogo, VIN repetidos, unidades conservadas.
    if (d.avisos && d.avisos.length) {
      alert('Viaje creado con avisos:\n\n' + d.avisos.join('\n'));
    }
    $('#modal-viaje').hidden = true;
    verViajes();
  } catch (err) {
    alert('No se pudo crear: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear';
  }
}

// ---------------------------------------------------------------- viajes

async function verViajes() {
  const playa = $('#f-playa').value;
  const fecha = $('#f-fecha').value;
  const q = new URLSearchParams();
  if (playa) q.set('playa', playa);
  if (fecha) q.set('fecha', fecha);

  try {
    const d = await pedir('../api/unidades/viajes?' + q.toString());
    for (const v of d.viajes) await DBU.guardarViaje(v);
    pintarViajes(d.viajes);
  } catch (e) {
    // Sin señal se muestra lo descargado: para eso se guardan los viajes.
    const guardados = await DBU.leerViajes();
    pintarViajes(guardados);
    if (guardados.length) estado('Mostrando viajes descargados', 'aviso');
  }
}

function pintarViajes(viajes) {
  const cont = $('#lista-viajes');
  if (!viajes.length) {
    cont.innerHTML = '<p class="nota">No hay viajes abiertos. Los crea la oficina; acá aparecen solos.</p>';
    return;
  }
  cont.innerHTML = viajes.map((v) => {
    const av = (v.avance || []).map((e) =>
      `<span class="chip-res">${e.nombre} ${e.hechas}/${v.unidades_total}</span>`).join(' ');
    return `
      <article class="item" data-uuid="${v.uuid}">
        <div class="item-txt">
          <div class="item-cab">
            <strong>${v.equipo_codigo || 's/equipo'}</strong>
            <small>${fmtFecha(v.fecha)}</small>
          </div>
          <div class="item-desvio">${v.flujo ? v.flujo.nombre : ''}</div>
          <small class="item-pie">${av}</small>
        </div>
      </article>`;
  }).join('');
}

async function abrirViaje(uuid) {
  let v;
  try {
    v = (await pedir('../api/unidades/viajes/' + uuid)).viaje;
    await DBU.guardarViaje(v);
  } catch (e) {
    v = await DBU.leerViaje(uuid);
    if (!v) { estado('Ese viaje no está descargado', 'malo'); return; }
    estado('Trabajando sin conexión', 'aviso');
  }

  VIAJE = v;
  ETAPA = etapasDeLaPlaya()[0] || null;

  $('#cab-viaje').innerHTML = `
    <div class="eq">${v.equipo_codigo || 's/equipo'}</div>
    <div class="sub">${v.flujo ? v.flujo.nombre : ''} · ${fmtFecha(v.fecha)} · ${(v.unidades || []).length} unidades</div>`;

  pintarEtapas();
  pintarUnidades();
  vista('unidades');
}

/**
 * Etapas que le tocan al inspector donde esta parado.
 *
 * Un viaje Sorocaba -> Zarate tiene precarga y carga en Brasil y la descarga
 * en Zarate. Con la playa elegida en el filtro se muestran solo las etapas de
 * esa playa; sin filtro, todas (es la vista del supervisor).
 *
 * La etapa puede declarar su playa; si no, ocurre en la del viaje.
 */
function etapasDeLaPlaya() {
  const etapas = (VIAJE.flujo && VIAJE.flujo.etapas) || [];
  const codigo = $('#f-playa').value;
  if (!codigo) return etapas;

  const playa = (CAT.playas || []).find((p) => p.codigo === codigo);
  if (!playa) return etapas;

  const propias = etapas.filter((e) => (e.playa_id || VIAJE.playa_id) === playa.id);
  // Si ninguna etapa le corresponde, se muestran todas antes que una pantalla
  // vacia sin explicacion.
  return propias.length ? propias : etapas;
}

function pintarEtapas() {
  const etapas = etapasDeLaPlaya();
  $('#etapas').innerHTML = etapas.map((e) => {
    const hechas = (VIAJE.unidades || []).filter((u) =>
      (u.inspecciones || []).some((i) => i.etapa_id === e.id)).length;
    return `<button type="button" class="etapa ${ETAPA && e.id === ETAPA.id ? 'sel' : ''}" data-etapa="${e.id}">
      ${e.nombre}<small>${hechas}/${(VIAJE.unidades || []).length}</small></button>`;
  }).join('');
}

function inspeccionDe(unidad) {
  if (!ETAPA) return null;
  return (unidad.inspecciones || []).find((i) => i.etapa_id === ETAPA.id) || null;
}

function pintarUnidades() {
  const unidades = VIAJE.unidades || [];
  $('#lista-unidades').innerHTML = unidades.map((u) => {
    const insp = inspeccionDe(u);
    const clase = !insp ? 'pend' : (insp.resultado === 'OK' ? 'ok' : 'ng');
    const badge = !insp
      ? '<span class="chip-res">Pendiente</span>'
      : `<span class="chip-res">${insp.resultado === 'OK' ? 'Sin daños' : (insp.danos || []).length + ' daño(s)'}</span>`;
    return `
      <article class="item ${clase}" data-unidad="${u.id}">
        <div class="orden">${u.orden_bajada != null ? u.orden_bajada : '-'}</div>
        <div class="item-txt">
          <div class="item-cab">
            <strong>${u.modelo ? u.modelo.nombre : 'Unidad'}</strong>
            ${badge}
          </div>
          <div class="item-vin">${u.vin}</div>
          <small class="item-pie">${u.destino ? u.destino.nombre : ''}</small>
        </div>
      </article>`;
  }).join('');
}

// ------------------------------------------------------------ inspeccion

function abrirUnidad(id) {
  const u = (VIAJE.unidades || []).find((x) => x.id === id);
  if (!u) return;
  if (inspeccionDe(u)) { estado('Esa unidad ya se inspeccionó en esta etapa', 'aviso'); return; }

  UNIDAD = u;
  DANOS = [];

  const idx = (VIAJE.unidades || []).indexOf(u) + 1;
  $('#insp-titulo').textContent = `Unidad ${idx} de ${(VIAJE.unidades || []).length}`;
  $('#insp-datos').innerHTML = `
    <div class="vin">${u.vin}</div>
    <div class="meta">${u.modelo ? u.modelo.nombre : ''} ${u.katashiki || ''}</div>
    <div class="meta">Orden de bajada ${u.orden_bajada != null ? u.orden_bajada : '-'} · ${u.destino ? u.destino.nombre : ''}</div>`;

  $('#btn-sin-danos').classList.remove('sel');
  $('#insp-obs').value = '';
  $('#foto-vin').value = '';
  $('#foto-pano').value = '';
  $('#lbl-pano').hidden = !(ETAPA && ETAPA.requiere_foto_panoramica);
  $('#bloque-firma').hidden = !(ETAPA && ETAPA.requiere_firma_inspector);
  limpiarFirma();
  pintarDanos();
  $('#modal-insp').hidden = false;
}

function pintarDanos() {
  $('#lista-danos').innerHTML = DANOS.map((d, i) => `
    <div class="dano">
      <div class="txt">
        <div class="p">${d.parte_nombre}${d.cuadrante ? ' · cuadrante ' + d.cuadrante : ''}</div>
        <div class="d">${d.tipo_nombre}${d.detalle_nuevo ? ' · ' + d.detalle_nuevo : ''}</div>
      </div>
      <button type="button" class="quitar" data-quitar="${i}" aria-label="Quitar">&times;</button>
    </div>`).join('');

  // Marcar "sin daños" y cargar daños son excluyentes: si hay daños, el
  // resultado ya no puede ser OK.
  if (DANOS.length) $('#btn-sin-danos').classList.remove('sel');
}

async function guardarInspeccion() {
  const sinDanos = $('#btn-sin-danos').classList.contains('sel');
  if (!sinDanos && DANOS.length === 0) {
    alert('Marcá "Sin daños" o cargá al menos un daño.');
    return;
  }
  if (ETAPA && ETAPA.requiere_firma_inspector && firmaVacia()) {
    alert('Falta la firma del inspector.');
    return;
  }
  if (ETAPA && ETAPA.requiere_foto_panoramica && !$('#foto-pano').files[0]) {
    alert('Esta etapa pide foto panorámica.');
    return;
  }

  const btn = $('#insp-guardar');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const pano = $('#foto-pano').files[0];
    const vin = $('#foto-vin').files[0];

    await SyncU.encolar({
      unidad_id: UNIDAD.id,
      etapa_id: ETAPA.id,
      registrado_en: new Date().toISOString(),
      resultado: sinDanos ? 'OK' : 'CON_DANOS',
      observacion: $('#insp-obs').value.trim() || null,
      foto_panoramica: pano ? await Camara.comprimir(pano) : null,
      foto_vin: vin ? await Camara.comprimir(vin) : null,
      firma_inspector: firmaVacia() ? null : await firmaBlob(),
      danos: sinDanos ? [] : DANOS.map((d) => ({
        parte_id: d.parte_id,
        cuadrante: d.cuadrante,
        tipo_dano_id: d.tipo_dano_id,
        tipo_nuevo: d.tipo_nuevo,
        detalle_nuevo: d.detalle_nuevo,
        comentario: d.comentario,
        foto: d.foto
      }))
    });

    // Se refleja al instante aunque todavia no haya subido: el inspector tiene
    // que poder seguir con la unidad siguiente sin esperar la red.
    UNIDAD.inspecciones = UNIDAD.inspecciones || [];
    UNIDAD.inspecciones.push({
      etapa_id: ETAPA.id,
      resultado: sinDanos ? 'OK' : 'CON_DANOS',
      danos: DANOS.map(() => ({}))
    });
    await DBU.guardarViaje(VIAJE);

    $('#modal-insp').hidden = true;
    pintarEtapas();
    pintarUnidades();
  } catch (err) {
    alert('No se pudo guardar: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar';
  }
}

// ------------------------------------------------------------------ dano

function abrirDano() {
  DANO = { parte_id: null, cuadrante: 0, tipo_dano_id: null, tipo_nuevo: null };
  $('#buscar-parte').value = '';
  $('#detalle-dano').value = '';
  $('#foto-dano').value = '';
  $('#bloque-cuadrante').hidden = true;
  $('#bloque-tipo').hidden = true;
  $('#caja-tipo').hidden = true;
  $('#lbl-foto-dano').hidden = !(ETAPA && ETAPA.requiere_foto_por_dano);
  pintarPartes('');
  $('#modal-dano').hidden = false;
}

function pintarPartes(filtro) {
  const f = Similitud.normalizar(filtro);
  const lista = (CAT.partes || []).filter((p) => !f || Similitud.normalizar(p.nombre).includes(f));
  $('#partes').innerHTML = lista.slice(0, 40).map((p) =>
    `<button type="button" class="chip ${DANO.parte_id === p.id ? 'sel' : ''}" data-parte="${p.id}">${p.nombre}</button>`
  ).join('') || '<p class="nota">Ninguna pieza coincide.</p>';
}

/**
 * Grilla del estandar de localizacion de danos: la pieza vista desde el
 * frente, numerada de izquierda a derecha y de adelante hacia atras.
 * 9 para superficies grandes, 3 para pilares y zocalos, 1 donde no aplica.
 */
function pintarCuadrantes(parte) {
  const n = parte.cantidad_cuadrantes || 1;
  const cont = $('#cuadrantes');
  cont.className = 'cuadrantes g' + (n === 9 ? '9' : n === 3 ? '3' : '1');
  $('#cuad-ayuda').textContent = n === 1 ? '(esta pieza no se subdivide)' : `(${n} en esta pieza)`;

  if (n === 1) {
    cont.innerHTML = '<button type="button" class="cuad sel" data-cuad="0">Toda la pieza</button>';
    DANO.cuadrante = 0;
  } else {
    cont.innerHTML = Array.from({ length: n }, (_, i) =>
      `<button type="button" class="cuad" data-cuad="${i + 1}">${i + 1}</button>`).join('');
    DANO.cuadrante = 0;
  }
  $('#bloque-cuadrante').hidden = false;
}

function pintarTipos() {
  $('#tipos').innerHTML = (CAT.tipos_dano || []).map((t) =>
    `<button type="button" class="chip ${DANO.tipo_dano_id === t.id ? 'sel' : ''}" data-tipo="${t.id}">${t.nombre}</button>`
  ).join('');
  $('#bloque-tipo').hidden = false;
}

async function confirmarDano() {
  if (!DANO.parte_id) { alert('Elegí la pieza.'); return; }
  const parte = (CAT.partes || []).find((p) => p.id === DANO.parte_id);
  if (parte.cantidad_cuadrantes > 1 && !DANO.cuadrante) { alert('Tocá el cuadrante donde está el daño.'); return; }
  if (!DANO.tipo_dano_id && !DANO.tipo_nuevo) { alert('Elegí el tipo de daño.'); return; }

  const archivo = $('#foto-dano').files[0];
  if (ETAPA && ETAPA.requiere_foto_por_dano && !archivo) { alert('Esta etapa pide foto de cada daño.'); return; }

  const tipo = (CAT.tipos_dano || []).find((t) => t.id === DANO.tipo_dano_id);

  DANOS.push({
    parte_id: DANO.parte_id,
    parte_nombre: parte.nombre,
    cuadrante: DANO.cuadrante,
    tipo_dano_id: DANO.tipo_dano_id,
    tipo_nuevo: DANO.tipo_nuevo,
    tipo_nombre: tipo ? tipo.nombre : DANO.tipo_nuevo,
    detalle_nuevo: $('#detalle-dano').value.trim() || null,
    comentario: null,
    foto: archivo ? await Camara.comprimir(archivo) : null
  });

  $('#modal-dano').hidden = true;
  pintarDanos();
}

// ----------------------------------------------------------------- firma

let ctxFirma = null;
let dibujando = false;
let huboTrazo = false;

function iniciarFirma() {
  const c = $('#firma');
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = r.width * dpr;
  c.height = r.height * dpr;
  ctxFirma = c.getContext('2d');
  ctxFirma.scale(dpr, dpr);
  ctxFirma.lineWidth = 2;
  ctxFirma.lineCap = 'round';
  ctxFirma.lineJoin = 'round';
  // El trazo se lee sobre fondo transparente en los dos temas.
  ctxFirma.strokeStyle = getComputedStyle(document.body).color;

  const pos = (e) => {
    const b = c.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };
  c.addEventListener('pointerdown', (e) => {
    dibujando = true; huboTrazo = true;
    c.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctxFirma.beginPath(); ctxFirma.moveTo(x, y);
  });
  c.addEventListener('pointermove', (e) => {
    if (!dibujando) return;
    const [x, y] = pos(e);
    ctxFirma.lineTo(x, y); ctxFirma.stroke();
  });
  c.addEventListener('pointerup', () => { dibujando = false; });
  c.addEventListener('pointercancel', () => { dibujando = false; });
}

function limpiarFirma() {
  if (!ctxFirma) return;
  const c = $('#firma');
  ctxFirma.clearRect(0, 0, c.width, c.height);
  huboTrazo = false;
}

const firmaVacia = () => !huboTrazo;
const firmaBlob = () => new Promise((res) => $('#firma').toBlob(res, 'image/png'));

// -------------------------------------------------------------- eventos

$('#lista-viajes').addEventListener('click', (e) => {
  const a = e.target.closest('[data-uuid]');
  if (a) abrirViaje(a.dataset.uuid);
});
$('#volver-viajes').addEventListener('click', () => { vista('viajes'); verViajes(); });
$('#nuevo-viaje').addEventListener('click', abrirFormViaje);
$('#viaje-cancelar').addEventListener('click', () => { $('#modal-viaje').hidden = true; });
$('#form-viaje').addEventListener('submit', crearViaje);
$('[name=unidades]').addEventListener('input', (e) => {
  const n = parsearUnidades(e.target.value).length;
  $('#viaje-conteo').textContent = n ? `${n} unidad(es) detectada(s)` : '';
});
$('#f-playa').addEventListener('change', verViajes);
$('#f-fecha').addEventListener('change', verViajes);

$('#etapas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-etapa]');
  if (!b) return;
  ETAPA = etapasDeLaPlaya().find((x) => x.id === Number(b.dataset.etapa));
  pintarEtapas();
  pintarUnidades();
});

$('#lista-unidades').addEventListener('click', (e) => {
  const a = e.target.closest('[data-unidad]');
  if (a) abrirUnidad(Number(a.dataset.unidad));
});

$('#insp-cancelar').addEventListener('click', () => { $('#modal-insp').hidden = true; });
$('#insp-guardar').addEventListener('click', guardarInspeccion);
$('#btn-sin-danos').addEventListener('click', () => {
  if (DANOS.length) { alert('Ya cargaste daños. Quitalos si la unidad está bien.'); return; }
  $('#btn-sin-danos').classList.toggle('sel');
});
$('#btn-agregar-dano').addEventListener('click', abrirDano);
$('#lista-danos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-quitar]');
  if (!b) return;
  DANOS.splice(Number(b.dataset.quitar), 1);
  pintarDanos();
});
$('#firma-borrar').addEventListener('click', limpiarFirma);

$('#dano-cancelar').addEventListener('click', () => { $('#modal-dano').hidden = true; });
$('#dano-ok').addEventListener('click', confirmarDano);
$('#buscar-parte').addEventListener('input', (e) => pintarPartes(e.target.value));

$('#partes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-parte]');
  if (!b) return;
  DANO.parte_id = Number(b.dataset.parte);
  const parte = (CAT.partes || []).find((p) => p.id === DANO.parte_id);
  pintarPartes($('#buscar-parte').value);
  pintarCuadrantes(parte);
  pintarTipos();
});

$('#cuadrantes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cuad]');
  if (!b) return;
  DANO.cuadrante = Number(b.dataset.cuad);
  $$('#cuadrantes .cuad').forEach((c) => c.classList.toggle('sel', c === b));
});

$('#tipos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tipo]');
  if (!b) return;
  DANO.tipo_dano_id = Number(b.dataset.tipo);
  DANO.tipo_nuevo = null;
  pintarTipos();
});

// Tipo de dano fuera del catalogo: mismo criterio que en patrullas. Se
// muestran los parecidos antes de crear, contra el catalogo cacheado, porque
// esto se usa sin senal.
$('#add-tipo').addEventListener('click', () => { $('#caja-tipo').hidden = false; $('#tipo-nuevo').focus(); });
$('#tipo-cancelar').addEventListener('click', () => { $('#caja-tipo').hidden = true; $('#sug-tipo').innerHTML = ''; });

let tSug = null;
$('#tipo-nuevo').addEventListener('input', () => {
  clearTimeout(tSug);
  tSug = setTimeout(() => {
    const txt = $('#tipo-nuevo').value.trim();
    const cont = $('#sug-tipo');
    if (txt.length < 3 || !CAT) { cont.innerHTML = ''; return; }
    const ya = Similitud.exacto(txt, CAT.tipos_dano);
    if (ya) {
      cont.innerHTML = `<p class="aviso-sim">Ya existe como <b>${ya.nombre}</b>.</p>
        <button type="button" class="chip" data-usar="${ya.id}">Usar ese</button>`;
      return;
    }
    const cerca = Similitud.similares(txt, CAT.tipos_dano);
    cont.innerHTML = cerca.length
      ? '<p class="aviso-sim">¿No será alguno de estos?</p>' +
        cerca.map((d) => `<button type="button" class="chip" data-usar="${d.id}">${d.nombre}</button>`).join('')
      : '<p class="aviso-sim ok">No hay ninguno parecido.</p>';
  }, 250);
});

$('#sug-tipo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-usar]');
  if (!b) return;
  DANO.tipo_dano_id = Number(b.dataset.usar);
  DANO.tipo_nuevo = null;
  pintarTipos();
  $('#caja-tipo').hidden = true;
  $('#sug-tipo').innerHTML = '';
});

$('#tipo-ok').addEventListener('click', () => {
  const txt = $('#tipo-nuevo').value.replace(/\s+/g, ' ').trim();
  if (txt.length < 3) { alert('Escribí al menos 3 caracteres.'); return; }
  const ya = CAT && Similitud.exacto(txt, CAT.tipos_dano);
  if (ya) { DANO.tipo_dano_id = ya.id; DANO.tipo_nuevo = null; }
  else { DANO.tipo_nuevo = txt; DANO.tipo_dano_id = null; }
  pintarTipos();
  if (DANO.tipo_nuevo) {
    $('#tipos').insertAdjacentHTML('beforeend',
      `<button type="button" class="chip sel" disabled>${DANO.tipo_nuevo}</button>`);
  }
  $('#caja-tipo').hidden = true;
  $('#sug-tipo').innerHTML = '';
});

// -------------------------------------------------------------- tema

function aplicarTema(claro) {
  const raiz = document.documentElement;
  if (claro) raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');
  $('#tema').setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', claro ? '#f4f5f7' : '#0a0a0b');
  try { localStorage.setItem('yard-tema', claro ? 'claro' : 'oscuro'); } catch (e) { /* modo privado */ }
  // La firma se dibuja con el color del texto: al cambiar de tema hay que
  // reajustarlo o el trazo nuevo sale del color anterior.
  if (ctxFirma) ctxFirma.strokeStyle = getComputedStyle(document.body).color;
}
$('#tema').addEventListener('click', () =>
  aplicarTema(document.documentElement.getAttribute('data-tema') !== 'claro'));
aplicarTema(document.documentElement.getAttribute('data-tema') === 'claro');

// ------------------------------------------------------------- arranque

SyncU.alCambiar((s) => {
  if (s.tipo === 'sincronizando') estado('Sincronizando…', 'aviso');
  else if (s.tipo === 'sin_conexion') estado(`Sin conexión — ${s.pendientes || 0} pendiente(s)`, 'aviso');
  else if (s.tipo === 'sesion_vencida') estado('Sesión vencida — no se perdió nada', 'malo');
  else if (s.tipo === 'encolada') estado(`Guardada — ${s.pendientes} pendiente(s)`, 'aviso');
  else if (s.tipo === 'listo') {
    if (s.pendientes) estado(`${s.pendientes} pendiente(s)`, 'aviso');
    else { estado('Todo sincronizado', 'bueno'); setTimeout(() => estado(null), 3000); }
  }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

$('#f-fecha').value = new Date().toISOString().slice(0, 10);
iniciarFirma();
cargarCatalogos().then(() => { verViajes(); SyncU.sincronizar(); });
