'use strict';

/**
 * Control de bahias.
 *
 * Reemplaza el papel que hay en cada bahia. El problema del papel no es que se
 * pierda: es que **se llena en la oficina sin ir a mirar** y despues se deja en
 * la bahia. Todo lo de aca esta puesto contra eso.
 *
 * Como se entra: el inspector escanea el QR pegado en la bahia, que abre
 * `/yard/?b=<token>`. El shell ya esta cacheado, asi que el escaneo funciona
 * sin señal -- salvo el primero de un telefono nuevo, que necesita bajar la app.
 *
 * **El QR no prueba presencia, y conviene tenerlo claro.** Un QR es una URL
 * impresa: se puede fotografiar una vez y escanear desde la oficina. Lo que
 * hace caro mentir son las otras dos cosas:
 *
 *   - la foto, que sale de la camara y no de la galeria;
 *   - que cualquiera puede escanear el mismo QR durante el turno y ver lo que
 *     se reporto, parado en la bahia. Firmar de taquito pasa a ser una apuesta
 *     a que nadie vaya a mirar, que es algo que el papel nunca tuvo.
 *
 * Si igual siguen firmando sin ir, el paso siguiente es NFC en vez de QR: hay
 * que apoyar el telefono en el tag y eso no se fotografia.
 */
const Bahias = (() => {

  /** Lo que devolvio el servidor para el turno en curso. */
  let DATOS = null;
  /** Codigo de la bahia abierta en el detalle. */
  let abierta = null;
  /** Borrador del control que se esta cargando. */
  let form = null;
  /** Borrador de la auditoria. */
  let audit = null;

  const vacio = () => ({ respuestas: new Map(), foto: null, obs: '' });

  // ------------------------------------------------------------------- datos

  /**
   * Trae el estado de la ronda del turno en curso.
   *
   * Se pide con la clave de turno del **dispositivo**, no con la hora del
   * servidor: el telefono puede estar sincronizando algo que se cargo hace
   * horas, y la ronda que le interesa es la de cuando lo cargo.
   */
  async function cargar() {
    const t = Turnos.de(new Date());
    try {
      DATOS = await pedir('api/bahias?turno=' + encodeURIComponent(t.clave));
      DATOS.turnoLocal = t;
    } catch (e) {
      // Sin señal se sigue con lo ultimo que se sabe. La ronda es la tarea
      // menos conectada de la app: se hace caminando la playa.
      if (DATOS) DATOS.turnoLocal = t;
    }
    await superponerCola(t);
    return DATOS;
  }

  /**
   * Pone encima de la respuesta del servidor lo que este en la cola local.
   *
   * **Sin esto la ronda no sirve sin señal**, que es cuando se usa. `encolar`
   * vuelve cuando el control quedo guardado en el dispositivo, no cuando el
   * servidor lo confirmo: el inspector guarda la bahia 12, camina a la 13, y la
   * ronda le seguia diciendo "sin controlar" hasta que hubiera señal. Con media
   * playa sin cobertura, eso es todo el turno.
   *
   * Lo local siempre gana sobre lo remoto: si esta en la cola, es mas nuevo.
   */
  async function superponerCola(t) {
    if (!DATOS) return;
    let cola = [];
    try { cola = (await DB.leerCola()) || []; } catch (e) { return; }

    cola
      .filter((i) => i.tipo === 'bahia' && i.turno_clave === t.clave)
      .forEach((i) => {
        const b = (DATOS.bahias || []).find((x) => x.id === i.bahia_id);
        if (!b) return;
        b.control = {
          uuid: i.uuid,
          inspector: DATOS.usuario || { nombre: 'Vos' },
          registrado_en: i.registrado_en,
          items: i.items || [],
          observacion: i.observacion || null,
          foto: null,
          auditorias: [],
          // La fila lo muestra: guardado en el telefono, todavia sin confirmar.
          enCola: true
        };
      });

    // Las auditorias encoladas van sobre el control que auditan, este ya en el
    // servidor o tambien en la cola. Sin esto, auditabas y al repintar no
    // quedaba rastro: parecia que no se habia guardado.
    cola
      .filter((i) => i.tipo === 'auditoria')
      .forEach((i) => {
        const b = (DATOS.bahias || []).find((x) => x.control && x.control.uuid === i.control_uuid);
        if (!b) return;
        if (b.control.auditorias.some((a) => a.uuid === i.uuid)) return;
        b.control.auditorias.push({
          uuid: i.uuid,
          usuario: DATOS.usuario || { nombre: 'Vos' },
          registrado_en: i.registrado_en,
          coincide: i.coincide,
          observacion: i.observacion || null,
          propia: true,
          enCola: true
        });
      });
  }

  const bahiaPorCodigo = (c) =>
    (DATOS && DATOS.bahias || []).find((b) => String(b.codigo) === String(c));

  const bahiaPorToken = (tk) =>
    (DATOS && DATOS.bahias || []).find((b) => b.token === tk);

  /**
   * Cuantos items tienen novedad.
   *
   * Se cuenta lo que el inspector marco, no se vuelve a deducir de la cantidad:
   * el papel tiene tres columnas por item -- cantidad, ubicacion y estado -- y
   * una herramienta completa en cantidad puede estar rota o fuera de lugar.
   * Recalcularlo aca se comeria justamente esos dos casos.
   */
  const faltan = (ctrl) => (ctrl && ctrl.items || []).filter((i) => !i.conforme).length;

  const itemDe = (id) => (DATOS && DATOS.items || []).find((x) => x.id === id);
  const nombreItem = (id) => (itemDe(id) || {}).nombre || ('Ítem ' + id);

  /**
   * Un item esta respondido si se marco Conforme, o si se marco Novedad **y se
   * dijo cual**. Una novedad sin comentario no le sirve a nadie: el que lee la
   * ronda necesita saber que pasa, y es la columna Comentarios del papel.
   */
  const respondido = (r) => !!r && (r.conforme || (r.comentario || '').trim().length > 0);

  // ------------------------------------------------------------- vista ronda

  function verRonda() {
    if (!DATOS) { cargar().then(pintarRonda); pintarRonda(); return; }
    cargar().then(pintarRonda);
    pintarRonda();
  }

  function pintarRonda() {
    if (!DATOS) {
      $('#r-cuerpo').innerHTML = '<p class="nota centro">Sin conexión y sin ronda guardada.</p>';
      return;
    }

    const t = DATOS.turnoLocal || Turnos.de(new Date());
    const bahias = DATOS.bahias || [];
    const hechas = bahias.filter((b) => b.control);
    const conFalta = hechas.filter((b) => faltan(b.control));
    const restan = Turnos.restan();

    // El encabezado dice las dos cosas que importan de pie en la playa: cuanto
    // falta de la ronda y cuanto falta del turno.
    const cab = `
      <section class="card turno${t.activo ? '' : ' apagado'}">
        <header>
          <span class="eq-label">${esc(t.nombre)}</span>
          <b>${hechas.length} de ${bahias.length} bahías</b>
        </header>
        <div class="barra-prog" role="img"
             aria-label="${hechas.length} de ${bahias.length} bahías controladas">
          <span style="width:${bahias.length ? Math.round((hechas.length / bahias.length) * 100) : 0}%"></span>
        </div>
        <p class="mono turno-pie">
          ${ico('clock', 13)}
          ${t.activo
            ? (restan > 0
                ? `Vence ${hhmm(t.fin)} · faltan ${esc(Turnos.falta(restan))}`
                : `Venció ${hhmm(t.fin)}`)
            : `Turno cerrado ${hhmm(t.fin)} · el próximo abre 06:00`}
        </p>
      </section>`;

    const resumen = conFalta.length
      ? `<p class="nota alerta">${ico('alert-triangle', 14)}
           ${conFalta.length} ${conFalta.length === 1 ? 'bahía tiene' : 'bahías tienen'} algo faltante.</p>`
      : '';

    $('#r-cuerpo').innerHTML = cab + resumen + `<div class="bahias">${
      bahias.map(fila).join('')
    }</div>`;
  }

  /** Una bahia en la ronda. */
  function fila(b) {
    const c = b.control;
    const f = c ? faltan(c) : 0;
    const estado = !c ? 'pend' : f ? 'ng' : 'ok';
    const etiqueta = !c ? 'Sin controlar' : f ? `${f} ${f === 1 ? 'falta' : 'faltan'}` : 'Completa';

    return `
      <button type="button" class="bahia ${estado}" data-bahia="${esc(b.codigo)}">
        <span class="cod mono">${esc(b.codigo)}</span>
        <span class="txt">
          <b>${esc(b.nombre || 'Bahía ' + b.codigo)}</b>
          <small>${esc(etiqueta)}${c ? ' · ' + (c.enCola ? 'sin sincronizar' : esc(nombreCorto(c.inspector)) + ' ' + hhmm(c.registrado_en)) : ''}</small>
        </span>
        ${c && c.auditorias && c.auditorias.length
          ? `<span class="aud" title="${c.auditorias.length} auditoría(s)">${ico('shield-check', 14)}${c.auditorias.length}</span>`
          : ''}
      </button>`;
  }

  // ----------------------------------------------------------- vista bahia

  /** Abre el detalle de una bahia. `porQR` cambia el encabezado. */
  function verBahia(codigo, porQR) {
    abierta = String(codigo);
    form = vacio();
    audit = null;
    irA('bahia');
    if (!DATOS) cargar().then(() => pintarBahia(porQR));
    pintarBahia(porQR);
  }

  /** Entrada por QR: `/yard/?b=<token>`. */
  function abrirDesdeToken(token) {
    const ir = () => {
      const b = bahiaPorToken(token);
      if (b) { verBahia(b.codigo, true); return true; }
      return false;
    };
    if (ir()) return;
    cargar().then(() => {
      if (ir()) return;
      // Se cae a la ronda y no a patrullas: el que escaneo estaba parado en una
      // bahia, y dejarlo en otro modulo con un aviso que se borra a los tres
      // segundos no le dice donde quedo.
      toast('Código desconocido', 'Ese QR no corresponde a ninguna bahía', true);
      irA('ronda');
    });
  }

  function pintarBahia(porQR) {
    const b = bahiaPorCodigo(abierta);
    const cuerpo = $('#b-cuerpo');
    if (!b) {
      cuerpo.innerHTML = '<p class="nota centro">No se encontró la bahía.</p>';
      return;
    }

    $('#titulo').textContent = b.nombre || 'Bahía ' + b.codigo;
    $('#eyebrow').textContent = (DATOS.turnoLocal || Turnos.de(new Date())).nombre;

    cuerpo.innerHTML = (porQR ? avisoQR(b) : '')
      + (b.control ? fichaControl(b) : formulario(b));
  }

  const avisoQR = (b) =>
    `<p class="nota qr">${ico('qr-code', 15)}<span>Escaneaste el QR de la bahía <b>${esc(b.codigo)}</b>.</span></p>`;

  // --- el formulario, cuando la bahia no se controlo todavia

  function formulario(b) {
    const items = DATOS.items || [];
    const resp = form.respuestas;
    const sinResponder = items.filter((i) => !respondido(resp.get(i.id))).length;

    // Nada preseleccionado, y hay que pronunciarse sobre cada herramienta. Con
    // un valor por defecto, guardar sin mirar vuelve a ser posible -- que es
    // exactamente el problema del papel que esto reemplaza.
    //
    // El detalle (cantidad, ubicacion, estado, comentario) solo aparece bajo
    // Novedad. En papel son 36 casilleros por bahia; con 18 bahias y guantes,
    // pedirlos todos siempre garantiza que se llenen de memoria.
    const lista = items.map((it) => {
      const r = resp.get(it.id);
      const abierto = !!r && !r.conforme;
      return `
        <div class="chk-item${respondido(r) ? ' resuelto' : ''}${abierto ? ' abierto' : ''}">
          <div class="chk-cab">
            <span class="chk-nom">${esc(it.nombre)}
              <small class="mono">STD ${it.cantidad_std}</small>
            </span>
            <div class="seg chico">
              <button type="button" data-chk="${it.id}" data-r="1" class="${r && r.conforme ? 'sel ok' : ''}">Conforme</button>
              <button type="button" data-chk="${it.id}" data-r="0" class="${abierto ? 'sel ng' : ''}">Novedad</button>
            </div>
          </div>
          ${abierto ? detalleItem(it, r) : ''}
        </div>`;
    }).join('');

    const puede = !sinResponder && form.foto;

    return `
      <div class="paso">
        <div class="cab">
          <span class="eq-label">Herramientas de la bahía</span>
          <span class="mono" id="b-contador" style="font-size:11px;color:var(--text-faint)">${items.length - sinResponder} de ${items.length}</span>
        </div>
        <div class="checklist">${lista}</div>
      </div>

      <div class="paso">
        <div class="cab">
          <span class="eq-label">Foto de la bahía</span>
          <span class="mono" style="font-size:11px;color:var(--text-faint)">obligatoria</span>
        </div>
        <div class="fotos una">
          ${form.foto
            ? `<div class="foto"><img src="${form.foto.url}" alt="">
                 <button type="button" class="quitar" data-quitar-foto aria-label="Quitar la foto">${ico('x', 13)}</button>
               </div>`
            : `<button type="button" class="foto-add" data-foto>${ico('camera', 20)}<span>Sacar foto</span></button>`}
        </div>
      </div>

      <label class="campo paso">
        <span>Observación</span>
        <textarea id="b-obs" rows="2" placeholder="Qué falta, dónde está">${esc(form.obs)}</textarea>
      </label>

      <p class="nota centro" id="b-falta"${puede ? ' hidden' : ''}>${
        sinResponder ? `Faltan ${sinResponder} herramienta${sinResponder === 1 ? '' : 's'} por responder.`
                     : 'Falta la foto de la bahía.'}</p>
      <button type="button" id="b-guardar" class="btn"${puede ? '' : ' disabled'}>Registrar control</button>`;
  }

  /** Las tres columnas del papel, que solo se piden cuando hay novedad. */
  function detalleItem(it, r) {
    return `
      <div class="chk-det">
        <div class="det-fila">
          <span class="eq-label">Cantidad</span>
          <div class="stepper">
            <button type="button" data-cant="${it.id}" data-d="-1" aria-label="Menos uno">−</button>
            <b class="mono${r.cantidad === it.cantidad_std ? '' : ' dif'}">${r.cantidad}</b>
            <button type="button" data-cant="${it.id}" data-d="1" aria-label="Más uno">+</button>
            <small class="mono">de ${it.cantidad_std}</small>
          </div>
        </div>
        <div class="det-fila">
          <span class="eq-label">Ubicación</span>
          <div class="seg chico">
            <button type="button" data-ub="${it.id}" data-v="1" class="${r.ubicacion_ok ? 'sel ok' : ''}">OK</button>
            <button type="button" data-ub="${it.id}" data-v="0" class="${r.ubicacion_ok ? '' : 'sel ng'}">NG</button>
          </div>
        </div>
        <div class="det-fila">
          <span class="eq-label">Estado</span>
          <div class="seg chico">
            <button type="button" data-est="${it.id}" data-v="1" class="${r.estado_ok ? 'sel ok' : ''}">OK</button>
            <button type="button" data-est="${it.id}" data-v="0" class="${r.estado_ok ? '' : 'sel ng'}">NG</button>
          </div>
        </div>
        <label class="campo">
          <span>Comentario</span>
          <input type="text" data-com="${it.id}" autocomplete="off"
                 value="${esc(r.comentario || '')}" placeholder="Qué pasa con esto">
        </label>
      </div>`;
  }

  // --- la ficha, cuando ya se controlo en este turno

  function fichaControl(b) {
    const c = b.control;
    const f = faltan(c);
    const faltantes = (c.items || []).filter((i) => !i.conforme);
    const auditorias = c.auditorias || [];

    const cuerpo = `
      <section class="card ${f ? 'acento' : ''}">
        <header>
          <span class="eq-label">Control del turno</span>
          <b>${f ? `${f} ${f === 1 ? 'faltante' : 'faltantes'}` : 'Bahía completa'}</b>
        </header>
        <p class="mono ficha-quien">
          ${esc(nombreCorto(c.inspector))} · ${hhmm(c.registrado_en)}
        </p>
        ${faltantes.length
          ? `<div class="novedades">${faltantes.map((i) => {
              const it = itemDe(i.item_id) || {};
              const partes = [];
              if (it.cantidad_std != null && i.cantidad !== it.cantidad_std) partes.push(`${i.cantidad} de ${it.cantidad_std}`);
              if (i.ubicacion_ok === false) partes.push('ubicación NG');
              if (i.estado_ok === false) partes.push('estado NG');
              return `
                <div class="nov">
                  <b>${esc(nombreItem(i.item_id))}</b>
                  ${partes.length ? `<span class="mono">${esc(partes.join(' · '))}</span>` : ''}
                  ${i.comentario ? `<small>${esc(i.comentario)}</small>` : ''}
                </div>`;
            }).join('')}</div>`
          : ''}
        ${c.observacion ? `<p class="obs">${esc(c.observacion)}</p>` : ''}
        ${c.foto ? `<button type="button" class="mini grande" data-ver="uploads/${esc(c.foto)}">
                      <img src="uploads/${esc(c.foto)}" alt="" loading="lazy"></button>` : ''}
      </section>`;

    // La auditoria es lo que le da dientes al QR: cualquiera que pase puede
    // decir si lo reportado coincide con lo que hay.
    //
    // No se ofrece sobre un control que sigue en la cola: es el que acabas de
    // cargar vos, y auditarse a uno mismo no dice nada. Cuando sincronice, lo
    // va a poder auditar cualquier otro que escanee el QR.
    const yaAudito = auditorias.some((a) => a.propia);
    const panel = c.enCola
      ? `<p class="nota">${ico('clock', 14)} Guardado en el teléfono. Se sincroniza cuando haya señal.</p>`
      : audit
        ? panelAuditoria()
        : yaAudito
          ? `<p class="nota">${ico('shield-check', 14)} Ya auditaste este control.</p>`
          : `<button type="button" id="b-auditar" class="btn sec">${ico('shield-check', 16)} Auditar este control</button>`;

    const lista = auditorias.length
      ? `<div class="paso">
           <span class="eq-label">Auditorías</span>
           ${auditorias.map((a) => `
             <div class="aud-fila ${a.coincide ? 'ok' : 'ng'}">
               ${ico(a.coincide ? 'circle-check' : 'octagon-alert', 15)}
               <span><b>${esc(nombreCorto(a.usuario))}</b> ${a.coincide ? 'confirmó' : 'reportó diferencia'}
                 ${a.observacion ? `<small>${esc(a.observacion)}</small>` : ''}</span>
               <span class="mono">${hhmm(a.registrado_en)}</span>
             </div>`).join('')}
         </div>`
      : '';

    return cuerpo + `<div class="paso">${panel}</div>` + lista;
  }

  function panelAuditoria() {
    return `
      <section class="card acento">
        <header><span class="eq-label">Tu auditoría</span></header>
        <div class="seg" id="b-aud-seg">
          <button type="button" data-aud="1" class="${audit.coincide === true ? 'sel ok' : ''}">Coincide</button>
          <button type="button" data-aud="0" class="${audit.coincide === false ? 'sel ng' : ''}">No coincide</button>
        </div>
        <label class="campo" style="margin-top:12px">
          <span>Qué encontraste</span>
          <textarea id="b-aud-obs" rows="2" placeholder="Opcional si coincide">${esc(audit.obs)}</textarea>
        </label>
        <button type="button" id="b-aud-guardar" class="btn"
          ${audit.coincide === undefined ? ' disabled' : ''}>Registrar auditoría</button>
      </section>`;
  }

  // ---------------------------------------------------------------- guardar

  async function guardar() {
    const b = bahiaPorCodigo(abierta);
    if (!b) return;

    const items = (DATOS.items || []).map((i) => {
      const r = form.respuestas.get(i.id) || {};
      return {
        item_id: i.id,
        conforme: !!r.conforme,
        cantidad: r.cantidad != null ? r.cantidad : i.cantidad_std,
        ubicacion_ok: r.ubicacion_ok !== false,
        estado_ok: r.estado_ok !== false,
        comentario: (r.comentario || '').trim() || null
      };
    });
    const t = DATOS.turnoLocal || Turnos.de(new Date());

    const btn = $('#b-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      await Sync.encolar({
        tipo: 'bahia',
        bahia_id: b.id,
        turno_clave: t.clave,
        items,
        observacion: form.obs || null,
        // Se comprime aca y no al sincronizar: una foto de camara son ~4 MB y
        // la cola vive en IndexedDB, que tiene cuota.
        foto: form.foto ? await Camara.comprimir(form.foto.file) : null
      });
      toast('Control guardado', b.nombre || 'Bahía ' + b.codigo);
      form = vacio();
      await cargar();
      irA('ronda');
    } catch (e) {
      toast('No se pudo guardar', String(e.message || e), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar control'; }
    }
  }

  async function guardarAuditoria() {
    const b = bahiaPorCodigo(abierta);
    if (!b || !b.control || !audit) return;

    const btn = $('#b-aud-guardar');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      await Sync.encolar({
        tipo: 'auditoria',
        control_uuid: b.control.uuid,
        coincide: audit.coincide,
        observacion: audit.obs || null,
        foto: null
      });
      toast('Auditoría registrada', b.nombre || 'Bahía ' + b.codigo);
      audit = null;
      await cargar();
      pintarBahia(false);
    } catch (e) {
      toast('No se pudo guardar', String(e.message || e), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar auditoría'; }
    }
  }

  // -------------------------------------------------------- rondas anteriores

  async function verRondas() {
    const cont = $('#rr-lista');
    try {
      const d = await pedir('api/bahias/rondas?limite=20');
      cont.innerHTML = (d.rondas || []).map((r) => `
        <div class="fila">
          <div class="izq">
            <b>${esc(r.turno_nombre)}</b>
            <small>${esc(fmtDia(r.inicio))} · ${esc(nombreCorto(r.inspector))}</small>
          </div>
          <div class="der">
            <span class="mono">${r.hechas}/${r.total}</span>
            <small>${r.faltantes ? r.faltantes + ' faltantes' : 'sin faltantes'}</small>
          </div>
        </div>`).join('') || '<p class="nota centro">Todavía no hay rondas cerradas.</p>';
    } catch (e) {
      cont.innerHTML = '<p class="nota centro">Sin conexión. Las rondas anteriores necesitan señal.</p>';
    }
  }

  // ---------------------------------------------------------------- eventos

  document.addEventListener('click', (e) => {
    const t = e.target;

    const bah = t.closest('[data-bahia]');
    if (bah) { verBahia(bah.dataset.bahia); return; }

    const chk = t.closest('[data-chk]');
    if (chk) {
      const id = Number(chk.dataset.chk);
      const it = itemDe(id) || { cantidad_std: 0 };
      const previo = form.respuestas.get(id) || {};
      capturar();
      // La novedad arranca en el estandar y el inspector corrige lo que no da.
      // Preseleccionar NG en las tres seria adivinar cual de las tres falla, y
      // la que quede sin tocar se guardaria mal.
      form.respuestas.set(id, {
        item_id: id,
        conforme: chk.dataset.r === '1',
        cantidad: previo.cantidad != null ? previo.cantidad : it.cantidad_std,
        ubicacion_ok: previo.ubicacion_ok !== false,
        estado_ok: previo.estado_ok !== false,
        comentario: previo.comentario || ''
      });
      pintarBahia(false);
      return;
    }

    const cant = t.closest('[data-cant]');
    if (cant) {
      const id = Number(cant.dataset.cant);
      const r = form.respuestas.get(id);
      capturar();
      r.cantidad = Math.max(0, Math.min(99, r.cantidad + Number(cant.dataset.d)));
      pintarBahia(false);
      return;
    }

    const ub = t.closest('[data-ub]');
    if (ub) {
      capturar();
      form.respuestas.get(Number(ub.dataset.ub)).ubicacion_ok = ub.dataset.v === '1';
      pintarBahia(false);
      return;
    }

    const est = t.closest('[data-est]');
    if (est) {
      capturar();
      form.respuestas.get(Number(est.dataset.est)).estado_ok = est.dataset.v === '1';
      pintarBahia(false);
      return;
    }

    if (t.closest('[data-quitar-foto]')) {
      if (form.foto) URL.revokeObjectURL(form.foto.url);
      form.foto = null;
      capturar();
      pintarBahia(false);
      return;
    }

    if (t.closest('[data-foto]')) { $('#b-file').click(); return; }
    if (t.closest('#b-guardar')) { capturar(); guardar(); return; }

    if (t.closest('#b-auditar')) { audit = { coincide: undefined, obs: '' }; pintarBahia(false); return; }

    const aud = t.closest('[data-aud]');
    if (aud) {
      audit.obs = ($('#b-aud-obs') || {}).value || audit.obs;
      audit.coincide = aud.dataset.aud === '1';
      pintarBahia(false);
      return;
    }

    if (t.closest('#b-aud-guardar')) {
      audit.obs = ($('#b-aud-obs') || {}).value || '';
      guardarAuditoria();
      return;
    }
  });

  /**
   * Lo tipeado se lee al modelo ANTES de repintar.
   *
   * La pantalla se vuelve a dibujar entera en cada toque, asi que un comentario
   * a medio escribir se perderia al tocar el `+` de la cantidad de al lado. No
   * se repinta en cada tecla a proposito: eso le roba el foco al teclado.
   */
  function capturar() {
    const ta = $('#b-obs');
    if (ta) form.obs = ta.value;
    $$('[data-com]').forEach((inp) => {
      const r = form.respuestas.get(Number(inp.dataset.com));
      if (r) r.comentario = inp.value;
    });
  }

  /**
   * Al tipear el comentario el item pasa a estar respondido, y el boton se
   * tiene que habilitar en el momento. Se toca solo lo que cambia en vez de
   * repintar: repintar mientras se escribe le saca el foco al teclado.
   */
  function refrescarGate() {
    const btn = $('#b-guardar');
    if (!btn) return;
    const items = (DATOS && DATOS.items) || [];
    const sin = items.filter((i) => !respondido(form.respuestas.get(i.id))).length;
    const puede = !sin && !!form.foto;

    btn.disabled = !puede;
    const cont = $('#b-contador');
    if (cont) cont.textContent = (items.length - sin) + ' de ' + items.length;
    const nota = $('#b-falta');
    if (nota) {
      nota.hidden = puede;
      nota.textContent = sin
        ? `Faltan ${sin} herramienta${sin === 1 ? '' : 's'} por responder.`
        : 'Falta la foto de la bahía.';
    }
    $$('[data-com]').forEach((inp) => {
      const fila = inp.closest('.chk-item');
      if (fila) fila.classList.toggle('resuelto', respondido(form.respuestas.get(Number(inp.dataset.com))));
    });
  }

  document.addEventListener('input', (e) => {
    if (!form || !e.target.matches('[data-com], #b-obs')) return;
    capturar();
    refrescarGate();
  });

  /** La foto de la bahia. Se guarda sin comprimir y se comprime al encolar. */
  function tomarFoto(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (form.foto) URL.revokeObjectURL(form.foto.url);
    form.foto = { file, url: URL.createObjectURL(file) };
    capturar();
    pintarBahia(false);
  }

  /** Vuelve a pedir y repinta lo que este a la vista. Lo usa el sincronizador. */
  async function refrescar(vistaActual) {
    await cargar();
    if (vistaActual === 'bahia') pintarBahia(false);
    else pintarRonda();
  }

  return { cargar, refrescar, verRonda, verRondas, verBahia, abrirDesdeToken, pintarBahia, tomarFoto };
})();
