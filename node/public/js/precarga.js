'use strict';

/**
 * Inspeccion de unidades en precarga.
 *
 * Tercer modulo de la PWA, en el mismo `/yard/`. Reemplaza la app de AppSheet
 * donde el inspector registra los daños de cada unidad antes de la carga.
 *
 * El camino es: **bajadas -> solicitud -> escanear el VIN -> unidad -> daños**.
 *
 * Lo que cambia respecto de AppSheet no es la pantalla, es DONDE ocurre el
 * registro. Alla el orden real de bajada se anotaba despues, de memoria, en una
 * columna con una formula `MAX(...)+1`. Aca la unidad se abre escaneando la
 * etiqueta de VIN que el auto trae de fabrica, parado al lado del auto, y de ahi
 * sale el orden real. Es el mismo poka-yoke que el QR de las bahias: el papel se
 * llenaba en la oficina.
 *
 * **El orden real se deriva del momento del escaneo, no de un contador.** Ver
 * `ordenReal()` mas abajo.
 *
 * Usa los globales de `app.js` (`$`, `esc`, `ico`, `toast`, `irA`, `hhmm`,
 * `pedir`). Ese archivo carga DESPUES, asi que aca no se puede invocar nada de
 * eso en tiempo de carga: solo declarar y registrar listeners.
 */
const Precarga = (() => {

  /** Formatos de la etiqueta de VIN. No es QR: el auto ya viene etiquetado. */
  const FORMATOS_VIN = ['code_128', 'code_39', 'data_matrix'];

  let DATOS = null;        // { jornada, solicitudes: [...] } tal como llega
  let CATA = null;         // { partes: [...], tipos_dano: [...] }
  let puedeLeer = null;    // null = todavia no se pregunto; true/false = respuesta

  let solAbierta = null;   // id de la solicitud abierta en el detalle
  let vinAbierto = null;   // vin de la unidad abierta

  let form = null;         // borrador de la unidad que se esta cargando
  let destinoFoto = null;  // 'pano' | 'dano', para saber a que slot va el archivo

  /**
   * VINs escaneados en esta sesion, con el momento del escaneo.
   *
   * Vive en memoria y no en disco a proposito, igual que `desbloqueadas` en
   * bahias: recargar la app tiene que volver a pedir el escaneo. Lo que si
   * sobrevive es la unidad ya guardada, que sale de la cola o del servidor.
   */
  const escaneadas = new Map();

  /**
   * El borrador arranca **sin resultado elegido**.
   *
   * `resultado` es null hasta que el inspector toca "Sin daños" o "Con daños", y
   * hasta entonces no se puede guardar. Nada preseleccionado, por lo mismo que
   * el checklist de bahias: con un valor por defecto, guardar sin mirar vuelve a
   * ser posible -- y "la mire y estaba bien" tiene que ser algo que alguien
   * afirmo, no lo que queda si no se toca nada.
   */
  const vacio = (vin) => ({ vin, resultado: null, pano: null, danos: [], nuevo: null });

  /**
   * Estado del historial, aparte del de la jornada en curso.
   *
   * `clave` distinta de null significa que se entro a una jornada y se estan
   * viendo sus solicitudes. Se guarda para que volver desde el detalle de una
   * solicitud caiga donde estabas y no en la lista de arriba de todo.
   */
  const hist = { jornadas: null, clave: null, solicitudes: null, cargando: false };

  // --------------------------------------------------------------- datos

  /**
   * Trae la jornada entera: solicitudes CON sus unidades adentro.
   *
   * Un pedido por solicitud seria mas prolijo y no serviria: en la playa la
   * señal se corta, y el inspector abre el detalle justo cuando esta parado al
   * lado del camion. Una jornada son ~18 bahias por ~8 unidades, que entra
   * sobrado en un payload.
   */
  async function cargar() {
    const t = Turnos.de(new Date());
    try {
      if (!CATA) CATA = await pedir('api/precarga/catalogos');
      DATOS = await pedir('api/precarga/solicitudes?jornada=' + encodeURIComponent(t.clave));
    } catch (e) {
      // Sin señal se sigue con lo que ya estaba. Si no habia nada, la pantalla
      // lo dice; lo que no puede pasar es que se vacie lo que ya se mostraba.
    }
    if (DATOS) { DATOS.turnoLocal = t; await superponerCola(); }
    return DATOS;
  }

  /**
   * Pisa las unidades con lo que hay en la cola local.
   *
   * `Sync.encolar` vuelve cuando la unidad quedo guardada en el telefono, no
   * cuando el servidor la confirmo. Sin esto el inspector baja la unidad 3,
   * camina a la 4 y la lista le sigue diciendo que la 3 esta sin bajar hasta que
   * haya señal -- que con media playa sin cobertura es todo el turno.
   */
  async function superponerCola() {
    let cola = [];
    try { cola = await DB.leerCola(); } catch (e) { return; }

    const porVin = new Map();
    for (const it of cola) {
      if (it.tipo !== 'unidad') continue;
      porVin.set(it.solicitud_id + '|' + it.vin, it);
    }
    if (!porVin.size) return;

    for (const s of DATOS.solicitudes || []) {
      for (const u of s.unidades || []) {
        const it = porVin.get(s.id + '|' + u.vin);
        if (!it) continue;
        u.inspeccion = {
          uuid: it.uuid,
          escaneado_en: it.escaneado_en,
          registrado_en: it.registrado_en,
          danos: (it.danos || []).map((d) => ({
            parte_id: d.parte_id, tipo_dano_id: d.tipo_dano_id, comentario: d.comentario
          })),
          enCola: true,
          rechazada: it.estado === 'rechazada',
          motivo: it.motivo || null
        };
      }
    }
  }

  /** Busca en la jornada en curso y despues en la del historial que este abierta. */
  const solPorId = (id) => ((DATOS && DATOS.solicitudes) || []).find((s) => String(s.id) === String(id))
    || (hist.solicitudes || []).find((s) => String(s.id) === String(id));
  const unidadDe = (s, vin) => ((s && s.unidades) || []).find((u) => u.vin === vin);

  const parteDe = (id) => ((CATA && CATA.partes) || []).find((p) => String(p.id) === String(id));
  const danoDe = (id) => ((CATA && CATA.tipos_dano) || []).find((d) => String(d.id) === String(id));
  const nombreParte = (id) => { const p = parteDe(id); return p ? p.nombre : 'Parte ' + id; };
  const nombreDano = (id) => { const d = danoDe(id); return d ? d.nombre : 'Daño ' + id; };

  /**
   * El orden real de bajada de cada VIN de la solicitud.
   *
   * **Sale del momento del escaneo, no de un contador.** AppSheet usaba
   * `MAX(SELECT(Unidades[TASA]))+1`, que es lo primero que se le ocurre a
   * cualquiera y se rompe de dos formas que aca pasan todos los dias: dos
   * inspectores bajando la misma solicitud calculan el mismo maximo, y un
   * escaneo hecho sin señal a las 10:05 que sincroniza a las 14:00 se lleva el
   * numero que le corresponde a otro.
   *
   * El timestamp es el mismo hecho y no colisiona. El costo, que conviene tener
   * escrito: dos telefonos con el reloj corrido se ordenan mal entre si. Es el
   * orden de una jornada de playa, no un acta; si algun dia importa, el servidor
   * tiene `sincronizado_en` para desempatar.
   */
  function ordenReal(s) {
    const hechas = ((s && s.unidades) || [])
      .filter((u) => u.inspeccion && u.inspeccion.escaneado_en)
      .sort((a, b) => String(a.inspeccion.escaneado_en).localeCompare(String(b.inspeccion.escaneado_en)));
    const m = new Map();
    hechas.forEach((u, i) => m.set(u.vin, i + 1));
    return m;
  }

  /** Bajadas, con daño, y fuera del orden solicitado. */
  function resumen(s) {
    const orden = ordenReal(s);
    const total = ((s && s.unidades) || []).length;
    let bajadas = 0, conDano = 0, desviadas = 0;
    for (const u of (s && s.unidades) || []) {
      if (!u.inspeccion) continue;
      bajadas++;
      if ((u.inspeccion.danos || []).length) conDano++;
      const real = orden.get(u.vin);
      if (real && u.orden_solicitado && real !== u.orden_solicitado) desviadas++;
    }
    return { total, bajadas, conDano, desviadas, orden };
  }

  // ------------------------------------------------------- vista: bajadas

  function verBajadas() {
    cargar().then(pintarBajadas);
    pintarBajadas();
  }

  function pintarBajadas() {
    const cuerpo = $('#pc-cuerpo');
    if (!cuerpo) return;

    if (!DATOS) {
      cuerpo.innerHTML = '<p class="nota centro">No se pudieron traer las bajadas de hoy.</p>';
      return;
    }

    const sols = DATOS.solicitudes || [];
    if (!sols.length) {
      cuerpo.innerHTML = '<p class="nota centro">No hay solicitudes cargadas para esta jornada.</p>';
      return;
    }

    let uTotal = 0, uBajadas = 0, uDesv = 0;
    for (const s of sols) { const r = resumen(s); uTotal += r.total; uBajadas += r.bajadas; uDesv += r.desviadas; }

    const cab = `
      <section class="card turno">
        <header>
          <span class="eq-label">${esc(DATOS.turnoLocal ? DATOS.turnoLocal.nombre : 'Jornada')}</span>
          <span class="mono">${uBajadas}/${uTotal}</span>
        </header>
        <div class="barra-prog"><i style="width:${uTotal ? Math.round((uBajadas / uTotal) * 100) : 0}%"></i></div>
        <p class="turno-pie">
          ${sols.length} ${sols.length === 1 ? 'solicitud' : 'solicitudes'} ·
          ${uDesv ? `<b>${uDesv} fuera de orden</b>` : 'sin desvíos de orden'}
        </p>
      </section>`;

    // Agrupadas por bahia, que es como el inspector camina la playa: se para en
    // una bahia y baja lo que hay ahi, no salta de solicitud en solicitud.
    const porBahia = new Map();
    for (const s of sols) {
      const b = s.bahia || '—';
      if (!porBahia.has(b)) porBahia.set(b, []);
      porBahia.get(b).push(s);
    }

    const cuerpoHtml = Array.from(porBahia.keys()).sort().map((b) => `
      <div class="grupo-cab"><span class="mono">${esc(b)}</span></div>
      ${porBahia.get(b).map(filaSolicitud).join('')}`).join('');

    cuerpo.innerHTML = cab + `<div class="pc-lista">${cuerpoHtml}</div>`;
  }

  function filaSolicitud(s) {
    const r = resumen(s);
    const estado = !r.bajadas ? 'pend' : r.bajadas === r.total ? 'ok' : 'parcial';
    return `
      <button type="button" class="fila pc-sol ${estado}" data-sol="${esc(s.id)}">
        <span class="txt">
          <b class="mono">${esc(s.equipo || '—')}</b>
          <small>${esc(s.destino || '—')} · ${esc(s.codigo || '')}</small>
        </span>
        <span class="der">
          <span class="mono">${r.bajadas}/${r.total}</span>
          ${r.desviadas ? `<span class="badge warn sin-punto">${r.desviadas} fuera de orden</span>` : ''}
        </span>
      </button>`;
  }

  // ---------------------------------------------------- vista: solicitud

  function verSolicitud(id) {
    solAbierta = id;
    irA('solicitud');
    pintarSolicitud();
  }

  const dato = (etiqueta, valor, mono) => `
    <div class="pc-dato">
      <span class="eq-label">${esc(etiqueta)}</span>
      <b class="${mono ? 'mono' : ''}">${esc(valor == null || valor === '' ? '—' : valor)}</b>
    </div>`;

  function pintarSolicitud() {
    const cuerpo = $('#sol-cuerpo');
    if (!cuerpo) return;
    const s = solPorId(solAbierta);
    if (!s) { cuerpo.innerHTML = '<p class="nota centro">No se encontró la solicitud.</p>'; return; }

    $('#titulo').textContent = 'Equipo ' + (s.equipo || '');
    $('#eyebrow').textContent = (s.codigo || '') + ' · bahía ' + (s.bahia || '—');

    const r = resumen(s);

    const ficha = `
      <section class="card">
        <div class="pc-datos">
          ${dato('Transportista', s.transportista)}
          ${dato('Bahía', s.bahia, true)}
          ${dato('Destino', s.destino)}
          ${dato('Hora', s.hora ? hhmm(s.hora) : null, true)}
        </div>
      </section>

      <div class="rejilla tres" style="margin-top:12px">
        <div class="kpi"><b class="k-val">${r.bajadas}<small>/${r.total}</small></b><span class="k-pie">Bajadas</span></div>
        <div class="kpi${r.conDano ? ' negative' : ''}"><b class="k-val">${r.conDano}</b><span class="k-pie">Con daño</span></div>
        <div class="kpi${r.desviadas ? ' warn' : ''}"><b class="k-val">${r.desviadas}</b><span class="k-pie">Fuera de orden</span></div>
      </div>`;

    // En una jornada cerrada no se ofrece escanear. El camion ya salio: sumarle
    // una unidad despues seria decir que se vio lo que no se vio. Es la misma
    // regla que en patrullas, donde el boton de agregar observacion solo esta en
    // los controles de hoy.
    const pendientes = r.total - r.bajadas;
    const boton = s.cerrada
      ? `<p class="nota cerrado">La jornada cerró. ${pendientes
          ? `Quedaron ${pendientes} ${pendientes === 1 ? 'unidad sin bajar' : 'unidades sin bajar'}.`
          : 'Se bajaron todas.'}</p>`
      : pendientes
      ? `<button type="button" class="btn" id="pc-escanear">${ico('scan-line', 18)} Escanear unidad</button>
         <p class="nota qr">La unidad se abre escaneando su etiqueta de VIN, parado al lado del auto. De ahí sale el orden real de bajada.</p>`
      : `<p class="nota">Las ${r.total} unidades de esta solicitud ya se bajaron.</p>`;

    const lista = ((s.unidades) || [])
      .slice()
      .sort((a, b) => (a.orden_solicitado || 0) - (b.orden_solicitado || 0))
      .map((u) => filaUnidad(u, r.orden))
      .join('');

    cuerpo.innerHTML = ficha
      + `<div class="acciones-full">${boton}</div>`
      + `<div class="cab-lista"><span class="eq-label">Unidades solicitadas</span><span class="mono">${r.total}</span></div>`
      + `<div class="pc-lista">${lista}</div>`;
  }

  function filaUnidad(u, orden) {
    const insp = u.inspeccion;
    const real = orden.get(u.vin);
    const desvio = real && u.orden_solicitado && real !== u.orden_solicitado;
    const nDanos = insp ? (insp.danos || []).length : 0;

    const estado = !insp ? 'pend' : nDanos ? 'ng' : 'ok';
    const etiqueta = !insp ? 'Sin bajar'
      : nDanos ? `${nDanos} ${nDanos === 1 ? 'daño' : 'daños'}`
      : 'Sin daños';

    return `
      <button type="button" class="fila pc-unidad ${estado}" data-vin="${esc(u.vin)}">
        <span class="pc-orden ${desvio ? 'desvio' : ''}">
          <b class="mono">${real || '·'}</b>
          <small class="mono">de ${u.orden_solicitado || '—'}</small>
        </span>
        <span class="txt">
          <b class="mono">${esc(u.vin)}</b>
          <small>${esc(u.modelo || u.katashiki || '—')} · ${esc(etiqueta)}${insp && insp.enCola ? ' · sin sincronizar' : ''}</small>
        </span>
        ${desvio ? '<span class="badge warn sin-punto">fuera de orden</span>' : ''}
      </button>`;
  }

  // ------------------------------------------------------- vista: unidad

  function verUnidad(vin) {
    vinAbierto = vin;
    const u = unidadDe(solPorId(solAbierta), vin);
    // Solo se arma el borrador si la unidad no esta cargada todavia. Volver a
    // entrar a una ya guardada no puede pisar lo que se guardo.
    if (u && !u.inspeccion && (!form || form.vin !== vin)) form = vacio(vin);
    irA('unidad');
    pintarUnidad();
  }

  function pintarUnidad() {
    const cuerpo = $('#un-cuerpo');
    if (!cuerpo) return;
    const s = solPorId(solAbierta);
    const u = unidadDe(s, vinAbierto);
    if (!u) { cuerpo.innerHTML = '<p class="nota centro">No se encontró la unidad.</p>'; return; }

    $('#titulo').textContent = u.vin;
    $('#eyebrow').textContent = (s.codigo || '') + ' · orden solicitado ' + (u.orden_solicitado || '—');

    cuerpo.innerHTML = u.inspeccion ? fichaUnidad(s, u)
      : s.cerrada ? `<section class="card gate">${ico('clock', 30)}<b>No se bajó</b>
          <p class="nota cerrado">La jornada cerró sin que esta unidad se registrara. No se puede cargar después.</p></section>`
      : escaneadas.has(u.vin) && form && form.vin === u.vin ? formulario(s, u)
      : gate(u);
  }

  /**
   * Sin escanear no se carga, sin excepcion.
   *
   * La lista de VINs de la solicitud SI se ve -- el inspector necesita saber que
   * viene. Lo que esta cerrado es abrir una unidad para cargarla. Es lo unico
   * que obliga a que el registro se haga al lado del auto, que es todo el punto;
   * cualquier escape lo reabre y volvemos al orden anotado de memoria.
   *
   * Costo asumido: una etiqueta ilegible frena esa unidad hasta que alguien la
   * resuelva. Es la misma apuesta que el sticker mojado de una bahia.
   */
  function gate(u) {
    if (puedeLeer === false) {
      return `
        <section class="card gate">
          ${ico('octagon-alert', 30)}
          <b>Este teléfono no puede leer la etiqueta</b>
          <p class="nota alerta">No soporta lectura de códigos de barras (Code&nbsp;128 / Code&nbsp;39), que es el formato de la etiqueta de VIN. La unidad no se puede cargar desde acá.</p>
        </section>`;
    }
    return `
      <section class="card gate">
        ${ico('scan-line', 30)}
        <b>Escaneá la etiqueta de VIN</b>
        <p class="nota qr">${esc(u.vin)}</p>
        <p class="nota">Está en el parabrisas o en el parante de la puerta. Escanearla abre la carga y deja registrado el orden real de bajada.</p>
        <button type="button" class="btn" id="pc-escanear">${ico('scan-line', 18)} Escanear</button>
      </section>`;
  }

  function formulario(s, u) {
    const orden = ordenReal(s);
    const proximo = Array.from(orden.values()).reduce((a, b) => Math.max(a, b), 0) + 1;
    const desvio = u.orden_solicitado && proximo !== u.orden_solicitado;

    const cabecera = `
      <section class="card acento">
        <div class="pc-datos">
          ${dato('Orden solicitado', u.orden_solicitado, true)}
          ${dato('Orden real', proximo, true)}
          ${dato('Modelo', u.modelo)}
          ${dato('S.O.', u.so, true)}
        </div>
        ${desvio ? `<p class="nota alerta">Se está bajando fuera del orden solicitado (iba ${u.orden_solicitado}.º).</p>` : ''}
      </section>`;

    const pano = `
      <section class="paso">
        <div class="cab"><span class="eq-label">Foto panorámica</span><span class="mono">opcional</span></div>
        <div class="fotos una">
          ${form.pano
            ? `<div class="foto"><img src="${form.pano.url}" alt=""><button type="button" class="quitar" data-quitar-pano>${ico('x', 12)}</button></div>`
            : `<button type="button" class="foto-add" data-foto="pano">${ico('camera', 20)}<span>Panorámica</span></button>`}
        </div>
      </section>`;

    // Nada preseleccionado: el inspector tiene que decir que encontro. Sin esto,
    // el formulario abria con "Guardar sin daños" listo para tocar y se podia
    // cerrar la unidad sin haberla mirado -- que es justo lo que el escaneo vino
    // a evitar del lado de la bajada.
    const resultado = `
      <section class="paso">
        <div class="cab"><span class="eq-label">¿Cómo está la unidad?</span></div>
        <div class="seg">
          <button type="button" data-res="OK" data-v="OK"${form.resultado === 'OK' ? ' class="sel"' : ''}>
            ${ico('circle-check', 16)} Sin daños
          </button>
          <button type="button" data-res="NG" data-v="NG"${form.resultado === 'NG' ? ' class="sel"' : ''}>
            ${ico('octagon-alert', 16)} Con daños
          </button>
        </div>
      </section>`;

    // Solo "Con daños" despliega, igual que solo "Novedad" despliega en bahias.
    const danos = form.resultado !== 'NG' ? '' : `
      <section class="paso">
        <div class="cab">
          <span class="eq-label">Daños</span>
          <span class="mono">${form.danos.length}</span>
        </div>
        ${form.danos.length
          ? `<div class="pc-danos">${form.danos.map(filaDano).join('')}</div>`
          : '<p class="nota">Cargá el primero: qué parte, de qué tipo y una foto.</p>'}
        ${form.nuevo ? subformDano() : `<button type="button" class="btn sec chico" id="pc-add-dano">${ico('plus', 15)} Agregar daño</button>`}
      </section>`;

    const listo = form.resultado === 'OK' || (form.resultado === 'NG' && form.danos.length);
    const etiqueta = !form.resultado ? 'Decí si tiene daños'
      : form.resultado === 'OK' ? 'Guardar sin daños'
      : !form.danos.length ? 'Cargá al menos un daño'
      : `Guardar con ${form.danos.length} ${form.danos.length === 1 ? 'daño' : 'daños'}`;

    const guardar = `
      <div class="acciones-full">
        <button type="button" class="btn" id="pc-guardar"${listo ? '' : ' disabled'}>${etiqueta}</button>
      </div>`;

    return cabecera + resultado + pano + danos + guardar;
  }

  function filaDano(d, i) {
    return `
      <div class="pc-dano">
        ${d.foto ? `<img src="${d.foto.url}" alt="">` : `<span class="pc-sinfoto">${ico('image', 16)}</span>`}
        <span class="txt">
          <b>${esc(nombreParte(d.parte_id))}</b>
          <small>${esc(nombreDano(d.tipo_dano_id))}${d.comentario ? ' · ' + esc(d.comentario) : ''}</small>
        </span>
        <button type="button" class="quitar" data-quitar-dano="${i}">${ico('x', 12)}</button>
      </div>`;
  }

  /**
   * Las partes del paso, ya filtradas y ordenadas.
   *
   * Con texto escrito busca sobre **todos los sectores**: el inspector sabe que
   * se golpeo la puerta trasera izquierda mucho antes de tener que decidir en
   * que sector la puso el formulario, y obligarlo a elegir sector primero le
   * cobra un paso por una clasificacion que es nuestra, no suya.
   *
   * Se normaliza con `Similitud.normalizar`, que saca los acentos: escribir
   * "optica" tiene que encontrar "Óptica" -- con guantes nadie pone la tilde.
   */
  function partesDelPaso(n) {
    const todas = (CATA && CATA.partes) || [];
    const q = Similitud.normalizar(n.busca || '');

    const base = q
      ? todas.filter((p) => Similitud.normalizar(p.nombre).includes(q))
      : todas.filter((p) => p.grupo === (n.grupo || todas[0].grupo));

    // Lo mas usado primero: cuatro partes son el 55% de los daños. "Otros"
    // siempre ultimo -- el cajon de sastre a mitad de lista invita a usarlo
    // antes de haber buscado.
    return base.slice().sort((a, b) =>
      (a.nombre === 'Otros') - (b.nombre === 'Otros')
      || (b.usos || 0) - (a.usos || 0)
      || a.nombre.localeCompare(b.nombre));
  }

  /** Las filas de la lista. Se repinta sola al escribir, sin tocar el resto. */
  function filasPartes(n) {
    const lista = partesDelPaso(n);
    if (!lista.length) {
      return `<p class="nota centro">Ninguna parte se llama así. Probá con menos letras, o cargala en <b>Otros</b> y contala en el comentario.</p>`;
    }
    const buscando = !!(n.busca || '').trim();
    return lista.map((p) => `
      <button type="button" class="pc-fila-parte" data-parte="${esc(p.id)}">
        <span class="txt">
          <b>${esc(p.nombre)}</b>
          ${buscando ? `<small>${esc(p.grupo)}</small>` : ''}
        </span>
        ${ico('chevron-left', 15)}
      </button>`).join('');
  }

  /**
   * El daño que se esta componiendo.
   *
   * Nada arranca preseleccionado, igual que el checklist de bahias: con un valor
   * por defecto, guardar sin mirar vuelve a ser posible.
   *
   * El paso de la parte se **colapsa** cuando ya se eligio una. Antes quedaban
   * los setenta chips arriba mientras se elegia el tipo, y en un telefono eso
   * empuja el resto del formulario abajo del pliegue.
   */
  function subformDano() {
    const n = form.nuevo;
    const todas = (CATA && CATA.partes) || [];
    const grupos = [];
    for (const p of todas) if (!grupos.includes(p.grupo)) grupos.push(p.grupo);
    const grupo = n.grupo || grupos[0];
    const buscando = !!(n.busca || '').trim();

    // Un auto golpeado suele estarlo en el mismo lugar, asi que el segundo daño
    // arranca donde termino el anterior en vez de volver a cero.
    const atajo = !n.parte_id && form.ultima && form.ultima.parte_id
      ? `<button type="button" class="pc-atajo" data-parte="${esc(form.ultima.parte_id)}">
           ${ico('plus', 14)} Otro en ${esc(nombreParte(form.ultima.parte_id))}
         </button>`
      : '';

    const paso1 = n.parte_id
      ? `<div class="pc-elegida">
           ${ico('check', 15)}
           <span class="txt"><b>${esc(nombreParte(n.parte_id))}</b><small>${esc(parteDe(n.parte_id).grupo)}</small></span>
           <button type="button" class="btn sec chico" id="pc-cambiar-parte">Cambiar</button>
         </div>`
      : `${atajo}
         <div class="buscador">
           ${ico('search', 15)}
           <input type="search" id="pc-busca" value="${esc(n.busca || '')}"
                  placeholder="Buscar parte…" autocomplete="off" enterkeyhint="search">
         </div>
         <div class="tags fila" id="pc-sectores"${buscando ? ' hidden' : ''}>
           ${grupos.map((g) => `<button type="button" class="tag${g === grupo ? ' sel' : ''}" data-grupo="${esc(g)}">${esc(g)}</button>`).join('')}
         </div>
         <div class="pc-partes" id="pc-lista-partes">${filasPartes(n)}</div>`;

    // Los tipos van ordenados por uso: Abollado y Rayado son el 77% de los
    // daños, y en el orden del catalogo quedaban cuarto y noveno.
    const tipos = ((CATA && CATA.tipos_dano) || []).slice()
      .sort((a, b) => (b.usos || 0) - (a.usos || 0));

    const paso2 = !n.parte_id ? '' : `
      <span class="eq-label pc-sep">Tipo de daño</span>
      <div class="tags">
        ${tipos.map((d) => `<button type="button" class="tag${String(d.id) === String(n.tipo_dano_id) ? ' sel' : ''}" data-tipodano="${esc(d.id)}">${esc(d.nombre)}</button>`).join('')}
      </div>

      <label class="campo pc-sep">
        <span>Comentario</span>
        <input type="text" id="pc-com" value="${esc(n.comentario || '')}" placeholder="Opcional" autocomplete="off">
      </label>

      <span class="eq-label pc-sep">Foto del daño <b class="pc-req">obligatoria</b></span>
      <div class="fotos una">
        ${n.foto
          ? `<div class="foto"><img src="${n.foto.url}" alt=""><button type="button" class="quitar" data-quitar-foto-dano>${ico('x', 12)}</button></div>`
          : `<button type="button" class="foto-add" data-foto="dano">${ico('camera', 20)}<span>Foto del daño</span></button>`}
      </div>`;

    const listo = n.parte_id && n.tipo_dano_id && n.foto;
    const falta = !n.parte_id ? 'Elegí la parte'
      : !n.tipo_dano_id ? 'Elegí el tipo de daño'
      : !n.foto ? 'Falta la foto'
      : 'Agregar el daño';

    return `
      <div class="pc-nuevo">
        <div class="cab">
          <span class="eq-label">Nuevo daño${form.danos.length ? ' · ' + (form.danos.length + 1) + '.º' : ''}</span>
          <button type="button" class="ib sm" id="pc-cancel-dano" aria-label="Cancelar">${ico('x', 14)}</button>
        </div>
        ${paso1}
        ${paso2}
        <button type="button" class="btn chico" id="pc-ok-dano" ${listo ? '' : 'disabled'}>${falta}</button>
      </div>`;
  }

  /** Lo que se cargo, ya guardado. No se edita: se corrige del lado de quien mira. */
  function fichaUnidad(s, u) {
    const insp = u.inspeccion;
    const real = ordenReal(s).get(u.vin);
    const desvio = real && u.orden_solicitado && real !== u.orden_solicitado;
    const danos = insp.danos || [];

    return `
      <section class="card acento">
        <div class="pc-datos">
          ${dato('Orden solicitado', u.orden_solicitado, true)}
          ${dato('Orden real', real, true)}
          ${dato('Bajada', insp.escaneado_en ? hhmm(insp.escaneado_en) : null, true)}
          ${dato('Modelo', u.modelo)}
        </div>
        ${desvio ? `<p class="nota alerta">Se bajó fuera del orden solicitado (iba ${u.orden_solicitado}.º).</p>` : ''}
        ${insp.enCola ? '<p class="nota">Guardada en el teléfono, todavía sin sincronizar.</p>' : ''}
        ${insp.rechazada ? `<p class="nota alerta">El servidor la rechazó: ${esc(insp.motivo || 'sin motivo')}. No se borró.</p>` : ''}
      </section>

      <div class="cab-lista"><span class="eq-label">Daños</span><span class="mono">${danos.length}</span></div>
      ${danos.length
        ? `<div class="pc-danos">${danos.map((d) => `
            <div class="pc-dano">
              ${d.foto ? `<img src="${esc(d.foto)}" alt="" data-ver="${esc(d.foto)}">` : `<span class="pc-sinfoto">${ico('image', 16)}</span>`}
              <span class="txt">
                <b>${esc(nombreParte(d.parte_id))}</b>
                <small>${esc(nombreDano(d.tipo_dano_id))}${d.comentario ? ' · ' + esc(d.comentario) : ''}</small>
              </span>
            </div>`).join('')}</div>`
        : '<p class="nota">Se revisó y no tenía daños.</p>'}`;
  }

  // ------------------------------------------------------------- escaneo

  /**
   * Saca los VIN que puedan estar en el texto leido.
   *
   * Devuelve TODOS los candidatos y no el primero: la etiqueta puede traer los
   * asteriscos de Code 39, un prefijo ISO o el numero de motor pegado, y si el
   * VIN no arranca en el caracter 0 quedarnos con la primera ventana de 17 lo
   * pierde. Quien llama se queda con el que reconoce.
   *
   * 17 caracteres, sin I, O ni Q: el estandar VIN no las usa justamente para no
   * confundirlas con 1 y 0.
   */
  function vinsDeTexto(texto) {
    const limpio = String(texto == null ? '' : texto).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const out = [];
    for (let i = 0; i + 17 <= limpio.length; i++) {
      const v = limpio.slice(i, i + 17);
      if (/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) out.push(v);
    }
    return out;
  }

  /**
   * Abre el lector para una solicitud.
   *
   * `validar` devuelve `true` o un texto de error, y el lector AVISA Y SIGUE
   * LEYENDO en vez de cerrarse. Escanear el auto de al lado con guantes y a
   * contraluz pasa seguido; cerrar el visor y obligar a empezar de nuevo cada
   * vez seria la forma mas rapida de que dejen de escanear.
   */
  async function escanearPara(s, vinEsperado) {
    if (puedeLeer === null) puedeLeer = await Escaner.soportaFormatos(FORMATOS_VIN);
    if (!puedeLeer) {
      toast('No se puede escanear', 'Este teléfono no lee códigos de barras', true);
      pintarUnidad();
      return;
    }

    const orden = ordenReal(s);

    const validar = (texto) => {
      const candidatos = vinsDeTexto(texto);
      if (!candidatos.length) return 'Ese código no es un VIN';

      for (const vin of candidatos) {
        const u = unidadDe(s, vin);
        if (!u) continue;
        if (u.inspeccion) return `Esa unidad ya se bajó (orden ${orden.get(vin) || '—'})`;
        if (vinEsperado && vin !== vinEsperado) return 'Esa es otra unidad de esta solicitud';
        return true;
      }
      for (const vin of candidatos) {
        const otra = ((DATOS && DATOS.solicitudes) || []).find(
          (o) => String(o.id) !== String(s.id) && (o.unidades || []).some((x) => x.vin === vin));
        if (otra) return `Ese VIN es de ${otra.codigo}, bahía ${otra.bahia}`;
      }
      return 'Ese VIN no está en las solicitudes de hoy';
    };

    try {
      const texto = await Escaner.abrir('Escaneá la etiqueta de VIN', validar, FORMATOS_VIN);
      const vin = vinsDeTexto(texto).find((v) => unidadDe(s, v));
      if (!vin) return;

      // El momento del escaneo es el dato: de aca sale el orden real.
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

  /** El archivo del input oculto, comprimido antes de mostrarlo. */
  async function tomarFoto(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !form) return;
    const blob = await Camara.comprimir(file);
    const foto = { blob, url: URL.createObjectURL(blob) };
    if (destinoFoto === 'pano') form.pano = foto;
    else if (form.nuevo) form.nuevo.foto = foto;
    pintarUnidad();
  }

  async function guardar() {
    const s = solPorId(solAbierta);
    const u = unidadDe(s, form && form.vin);
    if (!s || !u) return;

    // La pantalla ya lo bloquea; esto es para que no entre por otro lado.
    if (!form.resultado || (form.resultado === 'NG' && !form.danos.length)) return;

    const btn = $('#pc-guardar');
    const etiqueta = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      await Sync.encolar({
        tipo: 'unidad',
        solicitud_id: s.id,
        vin: form.vin,
        // El escaneo, no el guardado: entre uno y otro el inspector dio la
        // vuelta al auto y cargo tres daños, y el orden es el de la bajada.
        escaneado_en: escaneadas.get(form.vin) || new Date().toISOString(),
        foto_panoramica: form.pano ? form.pano.blob : null,
        danos: form.danos.map((d) => ({
          parte_id: d.parte_id,
          tipo_dano_id: d.tipo_dano_id,
          comentario: d.comentario || null,
          foto: d.foto ? d.foto.blob : null
        }))
      });

      toast('Unidad guardada', form.danos.length
        ? `${form.danos.length} ${form.danos.length === 1 ? 'daño' : 'daños'} en ${form.vin}`
        : `${form.vin}, sin daños`);

      form = null;
      await cargar();
      irA('solicitud');
      pintarSolicitud();
    } catch (e) {
      toast('No se pudo guardar', e && e.message === 'sin_memoria_ni_senal'
        ? 'Sin memoria local y sin señal' : 'Quedó pendiente', true);
      if (btn) { btn.disabled = false; btn.textContent = etiqueta; }
    }
  }

  // ----------------------------------------------------------- historial

  /**
   * Jornadas cerradas.
   *
   * Repinta lo que diga `hist`, no siempre la lista de arriba: si se habia
   * entrado a una jornada y despues a una solicitud, el boton de volver tiene
   * que caer en esa jornada y no mandarte al principio.
   */
  function verHistorial() {
    if (hist.clave) { pintarJornada(); return; }
    if (!hist.jornadas && !hist.cargando) {
      hist.cargando = true;
      pedir('api/precarga/jornadas?limite=14')
        .then((d) => { hist.jornadas = d.jornadas || []; })
        .catch(() => { hist.jornadas = []; })
        .then(() => { hist.cargando = false; pintarJornadas(); });
    }
    pintarJornadas();
  }

  /** Fecha y turno de una clave de jornada: '2026-08-27-tarde'. */
  function rotulo(clave) {
    const p = String(clave).split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12);
    return { dia: fmtDia(d), turno: p[3] === 'tarde' ? 'Segundo turno' : 'Primer turno' };
  }

  function pintarJornadas() {
    const cuerpo = $('#ph-cuerpo');
    if (!cuerpo) return;

    if (!hist.jornadas) { cuerpo.innerHTML = '<p class="nota centro">Cargando…</p>'; return; }
    if (!hist.jornadas.length) { cuerpo.innerHTML = '<p class="nota centro">Todavía no hay jornadas cerradas.</p>'; return; }

    // Los cuatro numeros por jornada, y no un renglon que diga "Completa": seis
    // filas iguales no informan nada. Lo que se viene a buscar aca es en que
    // jornada paso algo -- daños o bajadas fuera de orden.
    cuerpo.innerHTML = `<div class="pc-lista">${hist.jornadas.map((j) => {
      const r = rotulo(j.clave);
      return `
        <button type="button" class="fila pc-jornada${j.desviadas ? ' desvio' : ''}" data-jornada="${esc(j.clave)}">
          <span class="txt">
            <b>${esc(r.dia)}</b>
            <small>${esc(r.turno)} · ${j.solicitudes} ${j.solicitudes === 1 ? 'solicitud' : 'solicitudes'}</small>
          </span>
          <span class="pc-nums">
            <span><b class="mono">${j.unidades}</b><small>unid.</small></span>
            <span class="${j.con_dano ? 'malo' : ''}"><b class="mono">${j.con_dano}</b><small>daño</small></span>
            <span class="${j.desviadas ? 'aviso' : ''}"><b class="mono">${j.desviadas}</b><small>orden</small></span>
          </span>
        </button>`;
    }).join('')}</div>`;
  }

  function verJornada(clave) {
    hist.clave = clave;
    hist.solicitudes = null;
    pintarJornada();
    pedir('api/precarga/solicitudes?jornada=' + encodeURIComponent(clave))
      .then((d) => { hist.solicitudes = d.solicitudes || []; })
      .catch(() => { hist.solicitudes = []; })
      .then(pintarJornada);
  }

  function pintarJornada() {
    const cuerpo = $('#ph-cuerpo');
    if (!cuerpo) return;
    const r = rotulo(hist.clave);

    const cab = `
      <button type="button" class="btn sec chico" id="ph-volver">${ico('chevron-left', 15)} Todas las jornadas</button>
      <div class="cab-lista"><span class="eq-label">${esc(r.dia)} · ${esc(r.turno)}</span></div>`;

    if (!hist.solicitudes) { cuerpo.innerHTML = cab + '<p class="nota centro">Cargando…</p>'; return; }
    if (!hist.solicitudes.length) { cuerpo.innerHTML = cab + '<p class="nota centro">Esa jornada no tuvo bajadas.</p>'; return; }

    const porBahia = new Map();
    for (const s of hist.solicitudes) {
      const b = s.bahia || '—';
      if (!porBahia.has(b)) porBahia.set(b, []);
      porBahia.get(b).push(s);
    }

    cuerpo.innerHTML = cab + `<div class="pc-lista">${Array.from(porBahia.keys()).sort().map((b) => `
      <div class="grupo-cab"><span class="mono">${esc(b)}</span></div>
      ${porBahia.get(b).map(filaSolicitud).join('')}`).join('')}</div>`;
  }

  // ------------------------------------------------------------- eventos

  /**
   * Vuelca lo tipeado al modelo antes de repintar.
   *
   * Cada toque redibuja la pantalla entera, asi que lo que este en un input y no
   * en el objeto se pierde. Es el mismo `capturar()` de bahias, y esta por el
   * mismo motivo.
   */
  function capturar() {
    if (!form || !form.nuevo) return;
    const c = $('#pc-com');
    if (c) form.nuevo.comentario = c.value.trim();
    const b = $('#pc-busca');
    if (b) form.nuevo.busca = b.value;
  }

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const sol = t.closest('[data-sol]');
    if (sol) { verSolicitud(sol.dataset.sol); return; }

    const jor = t.closest('[data-jornada]');
    if (jor) { verJornada(jor.dataset.jornada); return; }

    if (t.closest('#ph-volver')) { hist.clave = null; hist.solicitudes = null; pintarJornadas(); return; }

    const uni = t.closest('[data-vin]');
    if (uni) { verUnidad(uni.dataset.vin); return; }

    if (t.closest('#pc-escanear')) {
      const s = solPorId(solAbierta);
      if (!s) return;
      const u = vinAbierto ? unidadDe(s, vinAbierto) : null;
      escanearPara(s, u && !u.inspeccion ? vinAbierto : null);
      return;
    }

    if (!form) return;   // de acá para abajo todo toca el borrador

    const res = t.closest('[data-res]');
    if (res) {
      capturar();
      form.resultado = res.dataset.res;
      // Pasar a "Sin daños" con daños cargados los borra: decir que no tiene y
      // tener tres es contradictorio, y el boton dice exactamente eso.
      if (form.resultado === 'OK') { form.danos = []; form.nuevo = null; }
      pintarUnidad();
      return;
    }

    if (t.closest('#pc-add-dano')) {
      capturar();
      form.nuevo = { grupo: (form.ultima && form.ultima.grupo) || null, busca: '',
                     parte_id: null, tipo_dano_id: null, comentario: '', foto: null };
      pintarUnidad();
      return;
    }
    if (t.closest('#pc-cancel-dano')) { form.nuevo = null; pintarUnidad(); return; }

    const grupo = t.closest('[data-grupo]');
    if (grupo && form.nuevo) {
      capturar();
      form.nuevo.grupo = grupo.dataset.grupo;
      form.nuevo.parte_id = null;   // cambiar de grupo no puede dejar elegida una parte de otro
      pintarUnidad();
      return;
    }

    const parte = t.closest('[data-parte]');
    if (parte && form.nuevo) {
      capturar();
      form.nuevo.parte_id = parte.dataset.parte;
      const p = parteDe(form.nuevo.parte_id);
      if (p) form.nuevo.grupo = p.grupo;   // el sector queda donde esta la parte
      form.nuevo.busca = '';
      pintarUnidad();
      return;
    }

    if (t.closest('#pc-cambiar-parte')) {
      capturar();
      form.nuevo.parte_id = null;
      pintarUnidad();
      return;
    }

    const tipo = t.closest('[data-tipodano]');
    if (tipo && form.nuevo) {
      capturar();
      form.nuevo.tipo_dano_id = form.nuevo.tipo_dano_id === tipo.dataset.tipodano ? null : tipo.dataset.tipodano;
      pintarUnidad();
      return;
    }

    const foto = t.closest('[data-foto]');
    if (foto) { capturar(); destinoFoto = foto.dataset.foto; $('#pc-file').click(); return; }

    if (t.closest('[data-quitar-pano]')) { form.pano = null; pintarUnidad(); return; }
    if (t.closest('[data-quitar-foto-dano]')) { capturar(); form.nuevo.foto = null; pintarUnidad(); return; }

    const quitar = t.closest('[data-quitar-dano]');
    if (quitar) { form.danos.splice(Number(quitar.dataset.quitarDano), 1); pintarUnidad(); return; }

    if (t.closest('#pc-ok-dano')) {
      capturar();
      const n = form.nuevo;
      if (!n || !n.parte_id || !n.tipo_dano_id || !n.foto) return;
      form.danos.push(n);
      form.ultima = { grupo: n.grupo, parte_id: n.parte_id };
      form.nuevo = null;
      pintarUnidad();
      return;
    }

    if (t.closest('#pc-guardar')) { capturar(); guardar(); return; }
  });

  // Escribir NO repinta: repintar en cada tecla le roba el foco al teclado y el
  // inspector pierde la palabra a medio escribir. Solo se actualiza el modelo.
  document.addEventListener('input', (e) => {
    if (!form || !form.nuevo) return;

    if (e.target.matches('#pc-com')) { form.nuevo.comentario = e.target.value.trim(); return; }

    if (e.target.matches('#pc-busca')) {
      // Repintar la pantalla entera le robaria el foco al teclado y el inspector
      // perderia la palabra a medio escribir. Solo se rehace la lista.
      form.nuevo.busca = e.target.value;
      const caja = $('#pc-lista-partes');
      if (caja) caja.innerHTML = filasPartes(form.nuevo);
      // Con texto escrito la busqueda cruza todos los sectores, asi que el
      // filtro por sector deja de significar algo y estorba.
      const sect = $('#pc-sectores');
      if (sect) sect.hidden = !!form.nuevo.busca.trim();
    }
  });

  /** Lo llama app.js cuando la cola sincroniza, para que deje de decir "sin sincronizar". */
  function refrescar(vistaActual) {
    cargar().then(() => {
      if (vistaActual === 'bajadas') pintarBajadas();
      if (vistaActual === 'solicitud') pintarSolicitud();
      if (vistaActual === 'unidad') pintarUnidad();
    });
  }

  return { cargar, refrescar, verBajadas, verSolicitud, verUnidad, verHistorial, pintarSolicitud, tomarFoto };
})();
