'use strict';

/**
 * Recepcion de unidades en destino.
 *
 * Cierra la cadena de custodia. Precarga registra con que daños **salio** el
 * auto; esto registra con cuales **llego**, y de la diferencia sale lo unico que
 * la operacion no podia contestar hasta ahora: **entre que dos puntos aparecio
 * la marca**.
 *
 * ⚠ **Es el primer modulo donde dos sitios comparten un registro.** Patrullas,
 * bahias y precarga son «un dispositivo escribiendo un hecho», y por eso andan
 * sin backend. Aca origen escribe y destino lee: contra el mock se prueba la
 * pantalla y el camino, **no el traspaso**. Ver YI-019.
 *
 * El formulario del daño es el mismo de precarga y vive en `danos.js`. Lo que
 * es propio de aca es el paso de resolucion.
 */
const Descarga = (() => {
  const FORMATOS_VIN = ['code_128', 'code_39', 'data_matrix'];

  let DATOS = null;        // { jornada, solicitudes: [...] }
  let solAbierta = null;
  let vinAbierto = null;
  let form = null;
  let puedeLeer = null;

  /**
   * Los VIN escaneados en esta sesion.
   *
   * Igual que en precarga: **sin escanear no se carga**. La lista de unidades se
   * ve --el inspector necesita saber que viene en el camion-- pero abrir una
   * para recibirla esta gateado. Ver D-015.
   */
  const escaneadas = new Map();

  const vacio = (vin) => ({
    vin,
    resoluciones: {},        // id del daño de origen -> 'sigue' | 'reparado'
    resultado: null,         // 'OK' | 'NG': si aparecio algo nuevo
    danos: [],
    nuevo: null,
    ultima: null,
    recibe: { nombre: '', rol: '' }
  });

  // ---------------------------------------------------------------- datos

  async function cargar() {
    const t = Turnos.de(new Date());
    try {
      await Danos.cargar();
      DATOS = await pedir('api/descarga/arribos?jornada=' + encodeURIComponent(t.clave));
    } catch (e) {
      // Sin señal se sigue con lo que ya estaba: lo que no puede pasar es que se
      // vacie lo que ya se mostraba.
    }
    if (DATOS) { DATOS.turnoLocal = t; await superponerCola(); }
    return DATOS;
  }

  const refrescar = () => cargar().then(() => { pintarArribos(); pintarRecepcion(); pintarUnidad(); });

  /**
   * Pisa las unidades con lo que hay en la cola local.
   *
   * `Sync.encolar` vuelve cuando la recepcion quedo guardada en el telefono, no
   * cuando el servidor la confirmo. Sin esto el inspector recibe la unidad 3,
   * camina a la 4 y la lista le sigue diciendo que la 3 esta sin recibir.
   */
  async function superponerCola() {
    let cola = [];
    try { cola = await DB.leerCola(); } catch (e) { return; }

    const porVin = new Map();
    for (const it of cola) {
      if (it.tipo !== 'recepcion') continue;
      porVin.set(it.solicitud_id + '|' + it.vin, it);
    }
    if (!porVin.size) return;

    for (const s of DATOS.solicitudes || []) {
      for (const u of s.unidades || []) {
        const it = porVin.get(s.id + '|' + u.vin);
        if (!it) continue;
        u.recepcion = {
          uuid: it.uuid,
          escaneado_en: it.escaneado_en,
          registrado_en: it.registrado_en,
          recibe: it.recibe,
          resoluciones: it.resoluciones || {},
          danos: (it.danos || []).map((d) => ({
            parte_id: d.parte_id, tipo_dano_id: d.tipo_dano_id,
            gravedad: d.gravedad, comentario: d.comentario,
            foto: urlDeFoto(d.foto), foto_calidad: d.foto_calidad
          })),
          enCola: true,
          rechazada: it.estado === 'rechazada',
          motivo: it.motivo || null
        };
      }
    }
  }

  /** Las fotos de la cola son Blob; memoizadas para no filtrar object URLs. */
  const urlDeBlob = new WeakMap();
  function urlDeFoto(f) {
    if (!f) return null;
    if (typeof f === 'string') return f;
    if (!(f instanceof Blob)) return null;
    if (!urlDeBlob.has(f)) urlDeBlob.set(f, URL.createObjectURL(f));
    return urlDeBlob.get(f);
  }

  const solPorId = (id) => ((DATOS && DATOS.solicitudes) || []).find((s) => String(s.id) === String(id));
  const unidadDe = (s, vin) => ((s && s.unidades) || []).find((u) => u.vin === vin);
  const danosDeOrigen = (u) => ((u && u.inspeccion && u.inspeccion.danos) || []);

  /**
   * Que paso con esta unidad entre origen y destino.
   *
   * Tres numeros y no uno: **siguio**, **se reparo** y **aparecio**. Un conteo
   * suelto no dice ninguna de las tres, que es justo lo que se viene a mirar.
   */
  function diferencia(u) {
    const r = u.recepcion;
    if (!r) return null;
    const origen = danosDeOrigen(u);
    const sigue = origen.filter((d) => (r.resoluciones || {})[d.id] === 'sigue');
    const reparado = origen.filter((d) => (r.resoluciones || {})[d.id] === 'reparado');
    return { sigue, reparado, nuevos: r.danos || [] };
  }

  const resumen = (s) => {
    const u = s.unidades || [];
    const recibidas = u.filter((x) => x.recepcion).length;
    const nuevos = u.reduce((a, x) => a + ((x.recepcion && x.recepcion.danos) || []).length, 0);
    return { total: u.length, recibidas, nuevos };
  };

  // -------------------------------------------------------------- arribos

  // No llama a `irA`: es al reves, `irA('arribos')` la llama a ella. Llamarla
  // desde aca daba recursion infinita.
  function verArribos() { cargar().then(pintarArribos); pintarArribos(); }

  function pintarArribos() {
    const cuerpo = $('#dc-cuerpo');
    if (!cuerpo) return;
    const sols = (DATOS && DATOS.solicitudes) || [];

    if (!sols.length) {
      cuerpo.innerHTML = `<p class="nota centro">No llegó ningún camión con unidades cargadas.</p>`;
      return;
    }

    const tot = sols.reduce((a, s) => {
      const r = resumen(s);
      return { total: a.total + r.total, recibidas: a.recibidas + r.recibidas, nuevos: a.nuevos + r.nuevos };
    }, { total: 0, recibidas: 0, nuevos: 0 });

    const cab = `
      <section class="card turno">
        <header>
          <span class="eq-label">${esc((DATOS.turnoLocal && DATOS.turnoLocal.nombre) || 'Turno')}</span>
          <span class="mono">${tot.recibidas}/${tot.total}</span>
        </header>
        <div class="barra-prog"><i style="width:${tot.total ? Math.round(tot.recibidas / tot.total * 100) : 0}%"></i></div>
        <p class="turno-pie">
          ${sols.length} ${sols.length === 1 ? 'camión' : 'camiones'}
          ${tot.nuevos ? ` · <b>${tot.nuevos} ${tot.nuevos === 1 ? 'daño nuevo' : 'daños nuevos'}</b>` : ''}
        </p>
      </section>`;

    // Agrupados por transportista, que es como llegan y como se reclama.
    const grupos = new Map();
    for (const s of sols) {
      const k = s.transportista || s.armador || '—';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(s);
    }

    cuerpo.innerHTML = cab + `<div class="pc-lista">` + Array.from(grupos.entries()).map(([k, ss]) => `
      <div class="grupo-cab"><span class="mono">${esc(k)}</span></div>
      ${ss.map(filaArribo).join('')}`).join('') + `</div>`;
  }

  function filaArribo(s) {
    const r = resumen(s);
    const estado = r.recibidas === 0 ? 'pend' : r.recibidas < r.total ? 'parcial' : 'ok';
    return `
      <button type="button" class="fila pc-sol ${estado}" data-arribo="${esc(s.id)}">
        <span class="txt">
          <b class="mono">${esc(s.equipo || '—')}</b>
          <small>${esc(s.destino || '')} · ${esc(s.codigo || '')}</small>
        </span>
        <span class="der">
          <span class="mono">${r.recibidas}/${r.total}</span>
          ${r.nuevos ? `<span class="badge risk sin-punto">${r.nuevos} ${r.nuevos === 1 ? 'nuevo' : 'nuevos'}</span>` : ''}
        </span>
      </button>`;
  }

  // ------------------------------------------------------------ recepcion

  function verRecepcion(id) { solAbierta = id; irA('recepcion'); pintarRecepcion(); }

  function pintarRecepcion() {
    const cuerpo = $('#dr-cuerpo');
    if (!cuerpo) return;
    const s = solPorId(solAbierta);
    if (!s) { cuerpo.innerHTML = '<p class="nota centro">No se encontró el camión.</p>'; return; }

    $('#titulo').textContent = 'Equipo ' + (s.equipo || '—');
    $('#eyebrow').textContent = (s.codigo || '') + ' · ' + (s.destino || '');

    const r = resumen(s);
    const datos = `
      <section class="card">
        <div class="pc-datos">
          ${dato('Transportista', s.transportista || s.armador)}
          ${dato('Destino', s.destino)}
          ${dato('Solicitud', s.codigo, true)}
          ${dato('Unidades', r.recibidas + ' de ' + r.total)}
        </div>
      </section>`;

    const accion = `
      <div class="acciones-full" style="margin-top:12px">
        <button type="button" class="btn" id="dc-escanear">${ico('scan-line', 18)} Escanear unidad</button>
      </div>`;

    cuerpo.innerHTML = datos + accion
      + `<div class="cab-lista"><span class="eq-label">Unidades</span><span class="mono">${r.total}</span></div>`
      + `<div class="pc-lista">${(s.unidades || []).map(filaUnidad).join('')}</div>`;
  }

  const dato = (k, v, mono) => `<div class="d"><span>${esc(k)}</span><b${mono ? ' class="mono"' : ''}>${esc(v || '—')}</b></div>`;

  function filaUnidad(u) {
    const d = diferencia(u);
    const orig = danosDeOrigen(u).length;
    const estado = !u.recepcion ? 'pend' : (d.nuevos.length || d.sigue.length) ? 'ng' : 'ok';
    const tags = d ? [
      d.sigue.length ? `<span class="cmp-tag sigue">${d.sigue.length} sigue${d.sigue.length > 1 ? 'n' : ''}</span>` : '',
      d.reparado.length ? `<span class="cmp-tag ok">${d.reparado.length} reparado${d.reparado.length > 1 ? 's' : ''}</span>` : '',
      d.nuevos.length ? `<span class="cmp-tag nuevo">${d.nuevos.length} nuevo${d.nuevos.length > 1 ? 's' : ''}</span>` : ''
    ].join('') : '';

    return `
      <button type="button" class="fila pc-unidad ${estado}" data-recibir="${esc(u.vin)}">
        <span class="txt">
          <b class="mono">${esc(u.vin)}</b>
          <small>${esc(u.modelo || '—')}${orig ? ` · salió con ${orig} ${orig === 1 ? 'daño' : 'daños'}` : ' · salió sin daños'}</small>
        </span>
        <span class="der">
          ${u.recepcion ? `<div class="cmp-tags">${tags || '<span class="cmp-tag ok">sin novedad</span>'}</div>` : ico('chevron-left', 16)}
        </span>
      </button>`;
  }

  // --------------------------------------------------------------- unidad

  function verUnidad(vin) { vinAbierto = vin; irA('recibida'); pintarUnidad(); }

  function pintarUnidad() {
    const cuerpo = $('#du-cuerpo');
    if (!cuerpo) return;
    const s = solPorId(solAbierta);
    const u = unidadDe(s, vinAbierto);
    if (!u) { cuerpo.innerHTML = '<p class="nota centro">No se encontró la unidad.</p>'; return; }

    $('#titulo').textContent = u.vin;
    $('#eyebrow').textContent = 'Recepción · ' + (u.modelo || '');

    if (u.recepcion) { cuerpo.innerHTML = ficha(s, u); return; }
    if (!escaneadas.has(u.vin)) { cuerpo.innerHTML = gate(u); return; }
    if (!form || form.vin !== u.vin) form = vacio(u.vin);
    cuerpo.innerHTML = formulario(s, u);
  }

  /** Sin escanear no se recibe. Mismo gate que precarga, mismo motivo. */
  function gate(u) {
    return `
      <section class="card gate">
        <p class="nota alerta">${ico('octagon-alert', 14)} Escaneá la etiqueta de VIN para recibir esta unidad.</p>
        <p class="nota">Se registra al lado del auto, no en la oficina.</p>
        <button type="button" class="btn" id="dc-escanear-esta">${ico('scan-line', 18)} Escanear ${esc(u.vin.slice(-6))}</button>
      </section>`;
  }

  /**
   * El formulario de recepcion.
   *
   * **Primero lo de origen, y hasta contestarlo no sigue.** Es el mismo paso que
   * patrullas hace con el NG anterior (`app.js pintarPendientes`), y esta por el
   * mismo motivo: si se pudiera saltear, el daño de origen queda colgado para
   * siempre -- que es exactamente lo que este paso vino a evitar.
   */
  function formulario(s, u) {
    const origen = danosDeOrigen(u);
    const todoResuelto = origen.every((d) => form.resoluciones[d.id]);

    const resolucion = !origen.length ? '' : `
      <section class="paso">
        <div class="cab">
          <span class="eq-label">Salió con esto</span>
          <span class="mono">${origen.length}</span>
        </div>
        <div class="dc-resol">
          ${origen.map((d) => {
            const r = form.resoluciones[d.id];
            return `
              <div class="dc-f">
                <span class="txt">
                  <b>${esc(Danos.nombreParte(d.parte_id))}</b>
                  <small>${esc(Danos.nombreDano(d.tipo_dano_id))}${d.comentario ? ' · ' + esc(d.comentario) : ''}</small>
                  ${Danos.etiquetaCodigo(d)}
                </span>
                <span class="par">
                  <button type="button" data-res="${esc(d.id)}" data-v="sigue" class="${r === 'sigue' ? 'sel' : ''}">Sigue</button>
                  <button type="button" data-res="${esc(d.id)}" data-v="reparado" class="${r === 'reparado' ? 'sel' : ''}">Reparado</button>
                </span>
              </div>`;
          }).join('')}
        </div>
        ${todoResuelto ? '' : '<p class="nota">Decí qué pasó con cada uno antes de seguir.</p>'}
      </section>`;

    // Hasta resolver lo de origen no se pregunta si aparecio algo nuevo.
    const pregunta = !todoResuelto ? '' : `
      <section class="paso">
        <span class="eq-label">¿Apareció algo en el viaje?</span>
        <div class="seg dos">
          <button type="button" data-dres="OK" class="${form.resultado === 'OK' ? 'sel' : ''}">Nada nuevo</button>
          <button type="button" data-dres="NG" class="${form.resultado === 'NG' ? 'sel ng' : ''}">Daños nuevos</button>
        </div>
      </section>`;

    const danos = form.resultado !== 'NG' ? '' : `
      <section class="paso">
        <div class="cab">
          <span class="eq-label">Daños nuevos</span>
          <span class="mono">${form.danos.length}</span>
        </div>
        ${form.danos.length
          ? `<div class="pc-danos">${form.danos.map(Danos.filaDano).join('')}</div>`
          : '<p class="nota">Cargá el primero: qué parte, de qué tipo y una foto.</p>'}
        ${form.nuevo ? Danos.subform(form, { foto: '#dc-file', titulo: 'Daño nuevo' }) : `<button type="button" class="btn sec chico" id="pc-add-dano">${ico('plus', 14)} Agregar daño</button>`}
      </section>`;

    /**
     * Quien recibe.
     *
     * En origen las firmas se descartaron con buen motivo: el inspector sale de
     * la sesion de ttfa. **Aca no aplica** -- quien recibe no es usuario del
     * sistema, y la sesion prueba quien cargo, no que el otro acepto.
     */
    const recibe = !todoResuelto || !form.resultado || form.nuevo ? '' : `
      <section class="paso">
        <span class="eq-label">Quién recibe <b class="pc-req">obligatorio</b></span>
        <label class="campo">
          <span>Nombre y apellido</span>
          <input type="text" id="dc-nombre" value="${esc(form.recibe.nombre)}" placeholder="Quien firma la recepción" autocomplete="off">
        </label>
        <div class="tags pc-sep">
          ${['Transportista', 'Consignatario', 'Playa'].map((r) => `<button type="button" class="tag${form.recibe.rol === r ? ' sel' : ''}" data-rol="${esc(r)}">${esc(r)}</button>`).join('')}
        </div>
      </section>`;

    const { listo, etiqueta } = estadoGuardar(origen);

    const guardar = form.nuevo ? '' : `
      <div class="acciones-full">
        <button type="button" class="btn" id="dc-guardar"${listo ? '' : ' disabled'}>${esc(etiqueta)}</button>
      </div>`;

    return `
      <section class="card">
        <div class="pc-datos">
          ${dato('Modelo', u.modelo)}
          ${dato('Katashiki', u.katashiki, true)}
          ${dato('Escaneada', hhmm(escaneadas.get(u.vin)))}
        </div>
      </section>
      ${resolucion}${pregunta}${danos}${recibe}${guardar}`;
  }

  /** Que dice y si esta habilitado el boton de guardar. */
  function estadoGuardar(origen) {
    const todoResuelto = (origen || []).every((d) => form.resoluciones[d.id]);
    const nombre = form.recibe.nombre.trim();
    return {
      listo: !!(todoResuelto && form.resultado
        && (form.resultado === 'OK' || form.danos.length) && nombre),
      etiqueta: !todoResuelto ? 'Resolvé lo que salió de origen'
        : !form.resultado ? 'Decí si apareció algo'
        : form.resultado === 'NG' && !form.danos.length ? 'Cargá al menos un daño'
        : !nombre ? 'Falta quién recibe'
        : 'Guardar la recepción'
    };
  }

  /**
   * Pone al dia el boton sin repintar.
   *
   * Escribir el nombre no puede rehacer el HTML --le roba el foco al teclado--
   * pero el boton tiene que dejar de decir «falta quien recibe» apenas se
   * escribio. Sin esto el inspector tipea y ve un boton apagado que ya deberia
   * estar prendido.
   */
  function refrescarGuardar() {
    const b = $('#dc-guardar');
    if (!b || !form) return;
    const s = solPorId(solAbierta);
    const u = unidadDe(s, form.vin);
    const { listo, etiqueta } = estadoGuardar(danosDeOrigen(u));
    b.disabled = !listo;
    b.textContent = etiqueta;
  }

  const hhmm = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  /** Lo ya recibido. No se edita: se corrige del lado de quien mira. */
  function ficha(s, u) {
    const d = diferencia(u);
    const r = u.recepcion;
    const lista = (titulo, clase, arr, deOrigen) => !arr.length ? '' : `
      <section class="paso">
        <div class="cab"><span class="eq-label">${esc(titulo)}</span><span class="mono">${arr.length}</span></div>
        <div class="pc-danos">${arr.map((x) => `
          <div class="pc-dano">
            ${x.foto ? `<img src="${esc(x.foto)}" alt="" data-ver="${esc(x.foto)}">` : `<span class="pc-sinfoto">${ico('image', 16)}</span>`}
            <span class="txt">
              <b>${esc(Danos.nombreParte(x.parte_id))}</b>
              <small>${esc(Danos.nombreDano(x.tipo_dano_id))}${x.comentario ? ' · ' + esc(x.comentario) : ''}</small>
              ${Danos.etiquetaCodigo(x)}${deOrigen ? '' : Danos.marcaFoto(x)}
            </span>
          </div>`).join('')}</div>
      </section>`;

    return `
      <section class="card">
        <div class="pc-datos">
          ${dato('Modelo', u.modelo)}
          ${dato('Recibió', r.recibe && r.recibe.nombre)}
          ${dato('Rol', r.recibe && r.recibe.rol)}
          ${dato('Hora', hhmm(r.registrado_en))}
        </div>
        ${r.enCola ? `<p class="nota">${ico('cloud-off', 14)} Guardada en el teléfono. Se sincroniza cuando haya señal.</p>` : ''}
      </section>
      <div class="rejilla tres" style="margin-top:12px">
        <div class="kpi${d.sigue.length ? ' negative' : ''}"><b class="k-val">${d.sigue.length}</b><span class="k-pie">Sigue</span></div>
        <div class="kpi"><b class="k-val">${d.reparado.length}</b><span class="k-pie">Reparado</span></div>
        <div class="kpi${d.nuevos.length ? ' warn' : ''}"><b class="k-val">${d.nuevos.length}</b><span class="k-pie">Apareció</span></div>
      </div>
      <div class="acciones-full" style="margin-top:12px">
        <button type="button" class="btn sec" data-hoja-dest="${esc(u.vin)}">${ico('file-text', 16)} Ver la hoja</button>
      </div>
      ${lista('Apareció en el viaje', 'nuevo', d.nuevos, false)}
      ${lista('Sigue desde origen', 'sigue', d.sigue, true)}
      ${lista('Se reparó', 'ok', d.reparado, true)}`;
  }

  // ----------------------------------------------------------------- hoja

  /**
   * La hoja de la unidad, ya con el bloque de recepcion lleno.
   *
   * **Es la misma hoja de precarga**, que ya reservaba el bloque en blanco con
   * el texto «la completa la app de descarga». Vive en una vista propia y no en
   * la de precarga porque el volver es distinto: desde aca se vuelve a la unidad
   * recibida, no a la de origen.
   */
  function verHoja(vin) { vinAbierto = vin; irA('hoja-dest'); pintarHoja(); }

  function pintarHoja() {
    const cuerpo = $('#hd-cuerpo');
    if (!cuerpo) return;
    const s = solPorId(solAbierta);
    const u = unidadDe(s, vinAbierto);
    if (!u) { cuerpo.innerHTML = '<p class="nota centro">No se encontró la unidad.</p>'; return; }

    $('#titulo').textContent = 'Hoja de la unidad';
    $('#eyebrow').textContent = u.vin;
    cuerpo.innerHTML = `
      <div class="hj-acciones">
        <button type="button" class="btn" id="hd-imprimir">${ico('file-text', 16)} Guardar PDF o imprimir</button>
      </div>` + Hoja.unidad(s, u, u.orden_solicitado);
  }

  /** El nombre del archivo sale del titulo, igual que en precarga. Ver D-018. */
  function imprimir() {
    const antes = document.title;
    document.title = 'recepcion-' + String(vinAbierto || '').replace(/[^A-Za-z0-9-]+/g, '-');
    const volver = () => { document.title = antes; window.removeEventListener('afterprint', volver); };
    window.addEventListener('afterprint', volver);
    setTimeout(volver, 60000);
    window.print();
  }

  // -------------------------------------------------------------- escaneo

  const vinsDeTexto = (texto) => {
    const out = [];
    const limpio = String(texto || '').toUpperCase();
    for (let i = 0; i + 17 <= limpio.length; i++) {
      const v = limpio.slice(i, i + 17);
      if (/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) out.push(v);
    }
    return out;
  };

  async function escanearPara(s, vinEsperado) {
    if (puedeLeer === null) puedeLeer = await Escaner.soportaFormatos(FORMATOS_VIN);
    if (!puedeLeer) {
      toast('No se puede escanear', 'Este teléfono no lee códigos de barras', true);
      return;
    }

    const validar = (texto) => {
      const candidatos = vinsDeTexto(texto);
      if (!candidatos.length) return 'Ese código no es un VIN';
      for (const vin of candidatos) {
        const u = unidadDe(s, vin);
        if (!u) continue;
        if (u.recepcion) return 'Esa unidad ya se recibió';
        if (vinEsperado && vin !== vinEsperado) return 'Esa es otra unidad de este camión';
        return true;
      }
      for (const vin of candidatos) {
        const otra = ((DATOS && DATOS.solicitudes) || []).find(
          (o) => String(o.id) !== String(s.id) && (o.unidades || []).some((x) => x.vin === vin));
        if (otra) return `Ese VIN vino en el equipo ${otra.equipo}`;
      }
      return 'Ese VIN no llegó en ningún camión de hoy';
    };

    try {
      const texto = await Escaner.abrir('Escaneá la etiqueta de VIN', validar, FORMATOS_VIN);
      const vin = vinsDeTexto(texto).find((v) => unidadDe(s, v));
      if (!vin) return;
      escaneadas.set(vin, new Date().toISOString());
      form = vacio(vin);
      verUnidad(vin);
    } catch (e) {
      const m = e && e.message;
      if (m === 'cancelado') return;
      toast('Sin escaneo', m === 'sin_permiso' ? 'No diste permiso a la cámara'
        : m === 'sin_soporte' ? 'Este teléfono no puede escanear'
        : 'No se pudo abrir la cámara', true);
    }
  }

  // -------------------------------------------------------------- guardar

  async function tomarFoto(input) {
    if (await Danos.tomarFoto(input, form)) pintarUnidad();
  }

  function capturarRecibe() {
    if (!form) return;
    const n = document.getElementById('dc-nombre');
    if (n) form.recibe.nombre = n.value;
  }

  async function guardar() {
    const s = solPorId(solAbierta);
    const u = unidadDe(s, form && form.vin);
    if (!s || !u) return;
    capturarRecibe();

    const btn = $('#dc-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    await Sync.encolar({
      tipo: 'recepcion',
      solicitud_id: s.id,
      vin: form.vin,
      turno_clave: Turnos.de(new Date()).clave,
      escaneado_en: escaneadas.get(form.vin) || new Date().toISOString(),
      registrado_en: new Date().toISOString(),
      recibe: { nombre: form.recibe.nombre.trim(), rol: form.recibe.rol || null },
      resoluciones: form.resoluciones,
      danos: form.danos.map((d) => ({
        parte_id: d.parte_id,
        tipo_dano_id: d.tipo_dano_id,
        gravedad: d.gravedad,
        comentario: d.comentario || null,
        foto: d.foto ? d.foto.blob : null,
        foto_calidad: (d.foto && d.foto.calidad) || null
      }))
    });

    form = null;
    await refrescar();
    verRecepcion(s.id);
    toast('Recepción guardada', u.vin);
  }

  // -------------------------------------------------------------- eventos

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const arr = t.closest('[data-arribo]');
    if (arr) { verRecepcion(arr.dataset.arribo); return; }

    const hd = t.closest('[data-hoja-dest]');
    if (hd) { verHoja(hd.dataset.hojaDest); return; }
    if (t.closest('#hd-imprimir')) { imprimir(); return; }

    const rec = t.closest('[data-recibir]');
    if (rec) { verUnidad(rec.dataset.recibir); return; }

    if (t.closest('#dc-escanear') || t.closest('#dc-escanear-esta')) {
      const s = solPorId(solAbierta);
      if (s) escanearPara(s, t.closest('#dc-escanear-esta') ? vinAbierto : null);
      return;
    }

    if (!form) return;   // de acá para abajo todo toca el borrador

    const res = t.closest('[data-res]');
    if (res) {
      capturarRecibe();
      form.resoluciones[res.dataset.res] = res.dataset.v;
      pintarUnidad();
      return;
    }

    const dres = t.closest('[data-dres]');
    if (dres) {
      capturarRecibe();
      form.resultado = dres.dataset.dres;
      // Pasar a "Nada nuevo" con daños cargados los borra, igual que en precarga.
      if (form.resultado === 'OK') { form.danos = []; form.nuevo = null; }
      pintarUnidad();
      return;
    }

    const rol = t.closest('[data-rol]');
    if (rol) {
      capturarRecibe();
      form.recibe.rol = form.recibe.rol === rol.dataset.rol ? '' : rol.dataset.rol;
      pintarUnidad();
      return;
    }

    if (t.closest('#pc-add-dano')) {
      capturarRecibe();
      Danos.capturar(form);
      form.nuevo = Danos.nuevoVacio(form);
      pintarUnidad();
      return;
    }

    // El formulario del daño lo maneja danos.js, igual que en precarga.
    if (Danos.manejarClic(t, form, pintarUnidad, { foto: '#dc-file' })) return;

    if (t.closest('#dc-guardar')) { guardar(); return; }
  });

  document.addEventListener('input', (e) => {
    if (!form) return;
    if (e.target.matches('#dc-nombre')) { form.recibe.nombre = e.target.value; refrescarGuardar(); return; }
    Danos.manejarInput(e, form);
  });

  return { cargar, refrescar, verArribos, verRecepcion, verUnidad, verHoja,
           pintarArribos, pintarRecepcion, pintarUnidad, pintarHoja, tomarFoto };
})();
