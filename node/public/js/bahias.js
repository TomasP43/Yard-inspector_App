'use strict';

/**
 * Control de bahias.
 *
 * Reemplaza el papel que hay en cada bahia. El problema del papel no es que se
 * pierda: es que **se llena en la oficina sin ir a mirar** y despues se deja en
 * la bahia. Todo lo de aca esta puesto contra eso.
 *
 * **Como se entra: desde la ronda, y el QR habilita.** El inspector toca la
 * bahia en la lista, la pantalla le pide escanear el QR del cartel, y recien
 * ahi aparece el checklist. El escaneo va con la camara **dentro de la app**.
 *
 * Se probo primero al reves -- el QR llevaba una URL y abria la app -- y este
 * orden es mejor por tres razones:
 *
 *   - si la sesion de ttfa vencio, la URL cae en un login y el inspector queda
 *     con el telefono en la mano frente a la bahia. Entrando desde la app, ya
 *     esta autenticado;
 *   - un telefono nuevo necesitaba señal para el primer escaneo. Desde la app,
 *     eso ya paso;
 *   - la ronda queda como centro: ves que falta, tocas, escaneas, cargas.
 *
 * **El QR lleva SOLO el token, no una URL.** Si llevara una URL, escanearlo con
 * la camara del sistema abriria la app por afuera del gate y el bloqueo seria
 * decorativo. Con token pelado, la camara del telefono muestra un texto sin
 * sentido y la unica puerta es esta.
 *
 * **Sin escanear no se carga. Sin excepcion.** Es una decision tomada sabiendo
 * el costo: un sticker mojado o despegado deja esa bahia sin poder controlarse
 * hasta que lo reimpriman. A cambio, es lo unico que obliga a que el control se
 * haga EN la bahia, que es todo el punto -- el papel que esto reemplaza se
 * llenaba en la oficina, y cualquier escape que dejemos aca lo reabre.
 *
 * Lo que el QR sigue sin probar es la presencia: se puede fotografiar el
 * sticker una vez y mostrarle la foto a la camara. Lo que encarece mentir son
 * la foto de la bahia y **que cualquiera puede auditar el control durante el
 * turno, parado ahi**. Si aun asi siguen firmando sin ir, el escalon siguiente
 * es NFC: hay que apoyar el telefono en el tag y eso no se fotografia.
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

  /**
   * Bahias cuyo QR se escaneo en esta sesion, por `codigo|turno`.
   *
   * Vive en memoria y no en disco: si la app se recarga, se vuelve a escanear.
   * Es lo correcto -- el desbloqueo dice "estoy parado aca ahora", y eso no
   * sobrevive a cerrar la app y volver dentro de un rato desde la oficina.
   */
  const desbloqueadas = new Set();
  const llaveDesbloqueo = (b, t) => b.codigo + '|' + t.clave;

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
          ${ico('clock', 14)}
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

  /** Abre el detalle de una bahia. */
  function verBahia(codigo) {
    abierta = String(codigo);
    form = vacio();
    audit = null;
    irA('bahia');
    if (!DATOS) cargar().then(pintarBahia);
    pintarBahia();
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

  function pintarBahia() {
    const b = bahiaPorCodigo(abierta);
    const cuerpo = $('#b-cuerpo');
    if (!b) {
      cuerpo.innerHTML = '<p class="nota centro">No se encontró la bahía.</p>';
      return;
    }

    $('#titulo').textContent = b.nombre || 'Bahía ' + b.codigo;
    $('#eyebrow').textContent = (DATOS.turnoLocal || Turnos.de(new Date())).nombre;

    const t = DATOS.turnoLocal || Turnos.de(new Date());
    const habilitada = desbloqueadas.has(llaveDesbloqueo(b, t));

    cuerpo.innerHTML = b.control ? fichaControl(b)
      : habilitada ? formulario(b)
      : gate(b);
  }

  /**
   * Sin escanear el QR no se carga. Es la decision del proyecto y es dura: un
   * sticker mojado deja esa bahia sin poder controlarse hasta que lo reimpriman.
   *
   * A cambio, es lo unico que hace que el control tenga que hacerse **en la
   * bahia**. El papel que esto reemplaza se llenaba en la oficina, y cualquier
   * escape que dejemos aca lo reabre.
   */
  function gate(b) {
    const sinLector = !Escaner.soportado();
    return `
      <section class="card gate">
        <div class="gate-ico">${ico('qr-code', 34)}</div>
        <b>Escaneá el QR de la bahía ${esc(b.codigo)}</b>
        <p>Está pegado en el cartel de la bahía. Sin escanearlo no se puede
           cargar el control: es lo que deja constancia de que el control se
           hizo acá.</p>
        ${sinLector
          ? `<p class="nota alerta">${ico('alert-triangle', 14)}
               <span>Este teléfono no puede leer QR desde la app.</span></p>`
          : `<button type="button" id="b-escanear" class="btn">${ico('camera', 16)} Escanear</button>`}
      </section>`;
  }

  /**
   * El QR lleva el token pelado. Se acepta igual una URL con `?b=` por si algun
   * sticker viejo quedo impreso asi, pero lo que se compara es siempre el token.
   */
  function tokenDeTexto(txt) {
    const s = String(txt || '').trim();
    const m = /[?&]b=([^&\s]+)/.exec(s);
    return m ? decodeURIComponent(m[1]) : s;
  }

  /** Abre la camara y desbloquea la bahia si el QR es el de esta bahia. */
  async function escanearPara(b) {
    const t = DATOS.turnoLocal || Turnos.de(new Date());
    try {
      await Escaner.abrir(`Bahía ${b.codigo}`, (txt) => {
        const tk = tokenDeTexto(txt);
        if (tk === b.token) return true;
        // Escanear el QR de la bahia de al lado es el error mas facil de
        // cometer y el mas confuso si solo dice "codigo invalido".
        const otra = bahiaPorToken(tk);
        return otra
          ? `Ese es el QR de la bahía ${otra.codigo}. Estás cargando la ${b.codigo}.`
          : 'Ese QR no es de ninguna bahía.';
      });
      desbloqueadas.add(llaveDesbloqueo(b, t));
      pintarBahia();
    } catch (e) {
      const m = {
        cancelado: null,
        sin_permiso: 'La app necesita permiso de cámara para leer el QR.',
        sin_camara: 'No se pudo abrir la cámara de este teléfono.',
        sin_soporte: 'Este teléfono no puede leer QR desde la app.'
      }[e.message];
      if (m) toast('No se pudo escanear', m, true);
    }
  }

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
                 <button type="button" class="quitar" data-quitar-foto aria-label="Quitar la foto">${ico('x', 14)}</button>
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
      pintarBahia();
    } catch (e) {
      toast('No se pudo guardar', String(e.message || e), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Registrar auditoría'; }
    }
  }

  // -------------------------------------------------------- rondas anteriores

  /**
   * Estado del historial: el mes que se esta mirando, el dia abierto, y el dia
   * contra el que se compara.
   */
  const hist = { mes: null, dias: null, a: null, b: null, eligiendoB: false };

  const isoF = (d) => d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  const MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  /** '12 de agosto'. En el detalle el dia se nombra entero, no en clave ISO. */
  function fechaLarga(iso) {
    const d = new Date(iso + 'T12:00:00');
    return d.getDate() + ' de ' + MES_LARGO[d.getMonth()].toLowerCase();
  }

  /** '12 ago'. Para encabezados de columna, donde no hay lugar para el largo. */
  function fechaCorta(iso) {
    const d = new Date(iso + 'T12:00:00');
    return d.getDate() + ' ' + MES_LARGO[d.getMonth()].toLowerCase().slice(0, 3);
  }

  // ------------------------------------------------------------- calendario

  async function verRondas(reiniciar) {
    if (reiniciar !== false) { hist.a = null; hist.b = null; hist.eligiendoB = false; }
    if (!hist.mes) { const h = new Date(); hist.mes = new Date(h.getFullYear(), h.getMonth(), 1); }
    await cargarMes();
    pintarCalendario();
  }

  async function cargarMes() {
    const m = hist.mes;
    const desde = isoF(new Date(m.getFullYear(), m.getMonth(), 1));
    const hasta = isoF(new Date(m.getFullYear(), m.getMonth() + 1, 0));
    try {
      const d = await pedir(`api/bahias/rondas?desde=${desde}&hasta=${hasta}`);
      hist.dias = {};
      (d.dias || []).forEach((x) => { hist.dias[x.fecha] = x.turnos || []; });
    } catch (e) {
      hist.dias = null;
    }
  }

  function pintarCalendario() {
    const cont = $('#rr-cuerpo');
    // Puede llegar aca con la vista todavia fuera del DOM: `verRondas` es
    // async y el usuario pudo cambiar de pantalla mientras se pedia el mes.
    if (!cont) return;
    if (!hist.dias) {
      cont.innerHTML = '<p class="nota centro">Sin conexión. El historial necesita señal.</p>';
      return;
    }

    const m = hist.mes;
    const primero = new Date(m.getFullYear(), m.getMonth(), 1);
    const cuantos = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    // La semana arranca el lunes: getDay() da 0 para domingo.
    const hueco = (primero.getDay() + 6) % 7;
    const hoyIso = isoF(new Date());

    const celdas = [];
    for (let i = 0; i < hueco; i++) celdas.push('<span class="dia vacio"></span>');

    for (let n = 1; n <= cuantos; n++) {
      const f = isoF(new Date(m.getFullYear(), m.getMonth(), n));
      const turnos = hist.dias[f] || [];
      // Amarillo = se hizo una sola ronda de las dos del dia, o sea faltó un
      // turno. Verde = los dos turnos rondaron.
      const clase = turnos.length >= 2 ? 'lleno' : turnos.length === 1 ? 'parcial' : 'sin';
      const nov = turnos.reduce((a, t) => a + (t.novedades || 0), 0);
      const sel = f === hist.a ? ' sel-a' : f === hist.b ? ' sel-b' : '';
      const clic = turnos.length ? ` data-dia="${f}"` : '';
      // Dos barritas, una por turno. El color del dia dice *cuantos* turnos
      // rondaron; esto dice **cual** faltó, que es lo que se necesita para ir a
      // preguntar. Con un solo tinte, un dia amarillo no distingue si el que se
      // salteo fue el de la mañana o el de la tarde.
      const seg = ['manana', 'tarde'].map((id) => {
        const t = turnos.find((x) => x.turno === id);
        return `<i class="${t ? (t.hechas < t.total ? 'medio' : 'si') : 'no'}"></i>`;
      }).join('');
      celdas.push(`
        <button type="button" class="dia ${clase}${sel}${f === hoyIso ? ' hoy' : ''}"
                ${clic}${turnos.length ? '' : ' disabled'}
                aria-label="${n} · ${turnos.length} de 2 turnos${nov ? ', ' + nov + (nov === 1 ? ' novedad' : ' novedades') : ''}">
          <b>${n}</b>
          ${nov ? `<span class="pip">${nov}</span>` : ''}
          <span class="turnos">${seg}</span>
        </button>`);
    }

    const conRonda = Object.values(hist.dias).filter((t) => t.length).length;
    const completos = Object.values(hist.dias).filter((t) => t.length >= 2).length;

    cont.innerHTML = `
      ${hist.eligiendoB ? `
        <p class="nota alerta">${ico('alert-triangle', 14)}
          <span>Elegí el día contra el que querés comparar ${esc(fechaLarga(hist.a))}.</span></p>` : ''}

      <div class="cal-cab">
        <button type="button" class="ib" id="cal-antes" aria-label="Mes anterior">${ico('chevron-left', 18)}</button>
        <b>${MES_LARGO[m.getMonth()]} ${m.getFullYear()}</b>
        <button type="button" class="ib" id="cal-despues" aria-label="Mes siguiente">${ico('chevron-left', 18)}</button>
      </div>

      <div class="cal-sem">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span>${d}</span>`).join('')}</div>
      <div class="cal">${celdas.join('')}</div>

      <div class="cal-ref">
        <span><i class="p lleno"></i>Los dos turnos</span>
        <span><i class="p parcial"></i>Faltó un turno</span>
        <span><i class="p sin"></i>Sin ronda</span>
      </div>
      <p class="nota centro">${completos} días completos · ${conRonda - completos} con un solo turno
        · ${cuantos - conRonda} sin ronda</p>`;
  }

  // ---------------------------------------------------------- detalle de dia

  async function verDia(fecha) {
    try {
      const d = await pedir('api/bahias/dia?fecha=' + encodeURIComponent(fecha));
      hist.a = fecha;
      hist.detalleA = d;
      pintarDia();
    } catch (e) {
      toast('No se pudo abrir el día', 'Sin conexión', true);
    }
  }

  function pintarDia() {
    const d = hist.detalleA;
    const cont = $('#rr-cuerpo');
    if (!cont) return;
    cont.innerHTML = `
      <div class="cal-cab">
        <button type="button" class="ib" id="dia-volver" aria-label="Volver al calendario">${ico('chevron-left', 18)}</button>
        <b>${esc(fechaLarga(d.fecha))}</b>
        <span style="width:34px"></span>
      </div>
      ${resumenDia(d)}
      ${bloquesTurno(d)}
      <button type="button" class="btn sec" id="dia-comparar">${ico('file-text', 16)} Comparar con otro día</button>`;
  }

  /** Los cuatro numeros del dia, antes de cualquier detalle. */
  function resumenDia(d) {
    const bs = d.turnos.flatMap((t) => t.bahias);
    const hechas = bs.filter((b) => b.control).length;
    const nov = bs.reduce((a, b) => a + (b.control ? faltan(b.control) : 0), 0);
    const conNov = bs.filter((b) => b.control && faltan(b.control)).length;
    const cob = bs.length ? Math.round((hechas / bs.length) * 100) : 0;

    const kpi = (val, sub, clase) => `
      <div class="kpi${clase ? ' ' + clase : ''}">
        <div class="k-val"><b>${val}</b></div>
        <div class="k-pie">${esc(sub)}</div>
      </div>`;

    return `<div class="rejilla">
      ${kpi(d.turnos.length + ' de 2', 'turnos con ronda', d.turnos.length < 2 ? 'warn' : 'positive')}
      ${kpi(cob + ' %', hechas + ' de ' + bs.length + ' controles', cob === 100 ? 'positive' : 'warn')}
      ${kpi(nov, nov === 1 ? 'novedad' : 'novedades', nov ? 'negative' : 'positive')}
      ${kpi(conNov, conNov === 1 ? 'bahía afectada' : 'bahías afectadas', conNov ? 'negative' : 'positive')}
    </div>`;
  }

  function bloquesTurno(d) {
    if (!d.turnos.length) return '<p class="nota centro">Ese día no tuvo ninguna ronda.</p>';
    return d.turnos.map((t) => {
      const nov = t.bahias.reduce((a, b) => a + (b.control ? faltan(b.control) : 0), 0);
      const horas = t.bahias.filter((b) => b.control)
        .map((b) => new Date(b.control.registrado_en)).sort((a, b) => a - b);
      const quien = (t.bahias.find((b) => b.control) || {}).control;

      return `
        <section class="card${nov ? ' acento' : ''}">
          <header>
            <span class="eq-label">${esc(t.nombre)}</span>
            <b>${t.hechas} de ${t.total} bahías${nov ? ` · ${nov} ${nov === 1 ? 'novedad' : 'novedades'}` : ''}</b>
          </header>
          ${horas.length ? `<p class="mono ficha-quien">
            ${esc(nombreCorto(quien.inspector))} · ${hhmm(horas[0])} a ${hhmm(horas[horas.length - 1])}
            ${horas.length > 1 ? `· ${Math.round((horas[horas.length - 1] - horas[0]) / 60000)} min de ronda` : ''}
          </p>` : ''}
          ${matriz(t, d.items)}
          ${listaNovedades(t, d.items)}
        </section>`;
    }).join('');
  }

  /**
   * Matriz bahias x items.
   *
   * Es la vista que la lista de renglones no daba: **una columna en rojo
   * significa que la misma herramienta falta en varias bahias**, y eso es un
   * problema de reposicion, no de una bahia puntual. Con seis renglones
   * diciendo "Completa" eso no se ve.
   */
  function matriz(t, items) {
    const cols = (items || []).slice().sort((a, b) => a.orden - b.orden);
    if (!cols.length) return '';

    const cab = `<span class="mz-esq"></span>` +
      cols.map((it) => `<span class="mz-num">${it.orden}</span>`).join('');

    const filas = t.bahias.map((b) => {
      const porItem = new Map((b.control ? b.control.items : []).map((i) => [i.item_id, i]));
      const celdas = cols.map((it) => {
        const r = porItem.get(it.id);
        const clase = !b.control ? 'nd' : (!r ? 'nd' : (r.conforme ? 'ok' : 'ng'));
        const tit = `${b.codigo} · ${it.nombre}` + (r && !r.conforme
          ? ` · ${r.cantidad} de ${it.cantidad_std}` : '');
        return `<span class="mz-c ${clase}" title="${esc(tit)}"></span>`;
      }).join('');
      return `<span class="mz-cod mono">${esc(b.codigo)}</span>${celdas}`;
    }).join('');

    return `
      <div class="matriz" style="--cols:${cols.length}">
        ${cab}${filas}
      </div>
      <details class="mz-ref">
        <summary>Qué es cada columna</summary>
        <ol>${cols.map((it) => `<li>${esc(it.nombre)} <i>· std ${it.cantidad_std}</i></li>`).join('')}</ol>
      </details>`;
  }

  /** Las novedades con todo el detalle: cantidad, ubicacion, estado, comentario. */
  function listaNovedades(t, items) {
    const filas = [];
    t.bahias.forEach((b) => {
      if (!b.control) return;
      (b.control.items || []).filter((i) => !i.conforme).forEach((i) => {
        const it = (items || []).find((x) => x.id === i.item_id) || {};
        const partes = [];
        if (it.cantidad_std != null && i.cantidad !== it.cantidad_std) {
          partes.push(`${i.cantidad} de ${it.cantidad_std}`);
        }
        if (i.ubicacion_ok === false) partes.push('ubicación NG');
        if (i.estado_ok === false) partes.push('estado NG');
        filas.push(`
          <div class="nov">
            <b>Bahía ${esc(b.codigo)} · ${esc(it.nombre || 'Ítem')}</b>
            ${partes.length ? `<span class="mono">${esc(partes.join(' · '))}</span>` : ''}
            ${i.comentario ? `<small>${esc(i.comentario)}</small>` : ''}
          </div>`);
      });
    });

    const sinControlar = t.bahias.filter((b) => !b.control).map((b) => b.codigo);
    const aviso = sinControlar.length
      ? `<p class="nota alerta">${ico('alert-triangle', 14)}
           <span>Sin controlar: ${sinControlar.map((c) => 'bahía ' + c).join(', ')}.</span></p>`
      : '';

    if (!filas.length) return aviso + '<p class="nota">Sin novedades en este turno.</p>';
    return aviso + `<div class="paso"><span class="eq-label">Novedades</span>
      <div class="novedades">${filas.join('')}</div></div>`;
  }

  // ------------------------------------------------------------ comparacion

  async function compararCon(fecha) {
    try {
      const d = await pedir('api/bahias/dia?fecha=' + encodeURIComponent(fecha));
      hist.b = fecha;
      hist.detalleB = d;
      hist.eligiendoB = false;
      pintarComparacion();
    } catch (e) {
      toast('No se pudo abrir el día', 'Sin conexión', true);
    }
  }

  /** Novedades de una bahia en un dia, sumando los dos turnos. */
  function novedadesPorBahia(d) {
    const mapa = new Map();
    (d.turnos || []).forEach((t) => {
      t.bahias.forEach((b) => {
        const previo = mapa.get(b.codigo) || { rondas: 0, items: new Set() };
        if (b.control) {
          previo.rondas++;
          (b.control.items || []).filter((i) => !i.conforme)
            .forEach((i) => previo.items.add(i.item_id));
        }
        mapa.set(b.codigo, previo);
      });
    });
    return mapa;
  }

  function pintarComparacion() {
    const A = hist.detalleA;
    const B = hist.detalleB;
    const ma = novedadesPorBahia(A);
    const mb = novedadesPorBahia(B);
    const codigos = [...new Set([...ma.keys(), ...mb.keys()])].sort((x, y) => x - y);

    const filas = codigos.map((cod) => {
      const a = ma.get(cod) || { rondas: 0, items: new Set() };
      const b = mb.get(cod) || { rondas: 0, items: new Set() };
      // Lo que importa de comparar dos dias: que se arreglo, que sigue, y que
      // apareció. Un conteo suelto no dice ninguna de las tres.
      const sigue = [...a.items].filter((i) => b.items.has(i));
      const corregido = [...a.items].filter((i) => !b.items.has(i));
      const nuevo = [...b.items].filter((i) => !a.items.has(i));
      const etiqueta = (arr, clase, txt) => arr.length
        ? `<span class="cmp-tag ${clase}">${txt} ${arr.length}</span>` : '';
      return `
        <div class="cmp-fila">
          <span class="cod mono">${cod}</span>
          <span class="cmp-cel">${a.rondas ? a.items.size + ' nov.' : '<i>sin ronda</i>'}</span>
          <span class="cmp-cel">${b.rondas ? b.items.size + ' nov.' : '<i>sin ronda</i>'}</span>
          <span class="cmp-tags">
            ${etiqueta(sigue, 'sigue', 'sigue')}
            ${etiqueta(corregido, 'ok', 'corregido')}
            ${etiqueta(nuevo, 'nuevo', 'nuevo')}
          </span>
        </div>`;
    }).join('');

    $('#rr-cuerpo').innerHTML = `
      <div class="cal-cab">
        <button type="button" class="ib" id="dia-volver" aria-label="Volver al calendario">${ico('chevron-left', 18)}</button>
        <b>Comparación</b>
        <span style="width:34px"></span>
      </div>
      <div class="cmp-cab">
        <span></span>
        <span>${esc(fechaCorta(A.fecha))}</span>
        <span>${esc(fechaCorta(B.fecha))}</span>
        <span>cambios</span>
      </div>
      <div class="cmp">${filas}</div>
      <p class="nota">Se compara por bahía sumando los dos turnos de cada día.
        <b>Sigue</b> es lo que estaba mal en ${esc(fechaLarga(A.fecha))} y seguía mal
        en ${esc(fechaLarga(B.fecha))}.</p>`;
  }

  // ---------------------------------------------------------------- eventos

  document.addEventListener('click', (e) => {
    const t = e.target;

    const bah = t.closest('[data-bahia]');
    if (bah) { verBahia(bah.dataset.bahia); return; }

    // --- historial
    const dia = t.closest('[data-dia]');
    if (dia) {
      if (hist.eligiendoB) compararCon(dia.dataset.dia);
      else verDia(dia.dataset.dia);
      return;
    }
    if (t.closest('#cal-antes')) {
      hist.mes = new Date(hist.mes.getFullYear(), hist.mes.getMonth() - 1, 1);
      verRondas(false);
      return;
    }
    if (t.closest('#cal-despues')) {
      hist.mes = new Date(hist.mes.getFullYear(), hist.mes.getMonth() + 1, 1);
      verRondas(false);
      return;
    }
    if (t.closest('#dia-volver')) { hist.eligiendoB = false; verRondas(false); return; }
    if (t.closest('#dia-comparar')) { hist.eligiendoB = true; verRondas(false); return; }

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
      pintarBahia();
      return;
    }

    const cant = t.closest('[data-cant]');
    if (cant) {
      const id = Number(cant.dataset.cant);
      const r = form.respuestas.get(id);
      capturar();
      r.cantidad = Math.max(0, Math.min(99, r.cantidad + Number(cant.dataset.d)));
      pintarBahia();
      return;
    }

    const ub = t.closest('[data-ub]');
    if (ub) {
      capturar();
      form.respuestas.get(Number(ub.dataset.ub)).ubicacion_ok = ub.dataset.v === '1';
      pintarBahia();
      return;
    }

    const est = t.closest('[data-est]');
    if (est) {
      capturar();
      form.respuestas.get(Number(est.dataset.est)).estado_ok = est.dataset.v === '1';
      pintarBahia();
      return;
    }

    if (t.closest('[data-quitar-foto]')) {
      if (form.foto) URL.revokeObjectURL(form.foto.url);
      form.foto = null;
      capturar();
      pintarBahia();
      return;
    }

    if (t.closest('#b-escanear')) {
      const b = bahiaPorCodigo(abierta);
      if (b) escanearPara(b);
      return;
    }

    if (t.closest('[data-foto]')) { $('#b-file').click(); return; }
    if (t.closest('#b-guardar')) { capturar(); guardar(); return; }

    if (t.closest('#b-auditar')) { audit = { coincide: undefined, obs: '' }; pintarBahia(); return; }

    const aud = t.closest('[data-aud]');
    if (aud) {
      audit.obs = ($('#b-aud-obs') || {}).value || audit.obs;
      audit.coincide = aud.dataset.aud === '1';
      pintarBahia();
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
    pintarBahia();
  }

  /** Vuelve a pedir y repinta lo que este a la vista. Lo usa el sincronizador. */
  async function refrescar(vistaActual) {
    await cargar();
    if (vistaActual === 'bahia') pintarBahia();
    else pintarRonda();
  }

  return { cargar, refrescar, verRonda, verRondas, verBahia, abrirDesdeToken, pintarBahia, tomarFoto };
})();
