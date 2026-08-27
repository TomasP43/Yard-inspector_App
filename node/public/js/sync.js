'use strict';

/**
 * Cola de sincronizacion.
 *
 * Regla que ordena todo esto: **una inspeccion solo sale de la cola cuando el
 * servidor confirma que la guardo.** Cualquier otra cosa (sin senal, sesion
 * vencida, error de red, respuesta rara) la deja donde esta.
 *
 * Los tres finales posibles de un envio:
 *   - 201 / 200      -> guardada. Se saca de la cola.
 *   - 401            -> sesion vencida. Se FRENA todo y se avisa. No se
 *                       descarta nada: el inspector se loguea y reintenta.
 *   - 4xx validacion -> la inspeccion tiene un problema real de datos. Se marca
 *                       como rechazada y se muestra, pero NO se borra: que la
 *                       vea una persona antes de perder el trabajo de campo.
 *   - red / 5xx      -> se reintenta despues.
 */
const Sync = (() => {
  let corriendo = false;
  const oyentes = [];

  function avisar(estado) { oyentes.forEach((f) => f(estado)); }
  function alCambiar(f) { oyentes.push(f); }

  /**
   * A donde va cada tipo de item de la cola.
   *
   * Los tres comparten las reglas de la cola sin excepcion: 401 frena todo, un
   * 4xx marca rechazada pero NO borra, un 5xx reintenta, y el `uuid` del
   * dispositivo hace idempotente el POST. Esas reglas costaron caro; un tipo
   * nuevo se suma aca y las hereda, no se escribe una cola aparte.
   */
  const RUTAS = {
    inspeccion: 'api/inspecciones',
    bahia:      'api/bahias/control',
    auditoria:  'api/bahias/auditoria'
  };

  /**
   * Sin `tipo` es una inspeccion. No es solo un default comodo: cuando se sumo
   * bahias podia haber items encolados por la version anterior, que no lo
   * traen. Sin esto se quedaban en la cola sin ruta, para siempre.
   */
  const tipoDe = (item) => item.tipo || 'inspeccion';

  async function armarPayload(item) {
    if (tipoDe(item) === 'bahia') return payloadBahia(item);
    if (tipoDe(item) === 'auditoria') return payloadAuditoria(item);

    const fotos = [];
    for (const f of item.fotos || []) {
      fotos.push({
        data: await Camara.aBase64(f.blob),
        orientacion: f.orientacion || 'libre'
      });
    }
    const payload = {
      uuid: item.uuid,
      registrado_en: item.registrado_en,
      responsable_id: item.responsable_id,
      equipo_codigo: item.equipo_codigo,
      resultado: item.resultado,
      tipo_desvio_id: item.tipo_desvio_id || null,
      desvio_ids: item.desvio_ids || [],
      // Texto libre: el servidor decide si ya existe o lo crea. No se resuelve
      // en el cliente porque puede haberse escrito sin conexion.
      desvios_nuevos: item.desvios_nuevos || [],
      demora_id: item.demora_id || null,
      detalle: item.detalle || null,
      controlador_id: item.controlador_id || null,
      estado_control_id: item.estado_control_id || null,
      fotos
    };
    if (item.foto_checklist) {
      payload.foto_checklist = await Camara.aBase64(item.foto_checklist);
    }
    return payload;
  }

  /**
   * El control de una bahia. `turno_clave` viaja desde el dispositivo y no se
   * deduce en el servidor a partir de la hora de llegada: si el control se
   * cargo a las 00:30 sin señal y sincroniza a las 07:00, el turno al que
   * pertenece es el que estaba abierto cuando se hizo, no el de ahora.
   */
  async function payloadBahia(item) {
    return {
      uuid: item.uuid,
      registrado_en: item.registrado_en,
      bahia_id: item.bahia_id,
      turno_clave: item.turno_clave,
      items: item.items || [],
      observacion: item.observacion || null,
      foto: item.foto ? await Camara.aBase64(item.foto) : null
    };
  }

  /** La auditoria de un control de bahia hecha por un tercero. */
  async function payloadAuditoria(item) {
    return {
      uuid: item.uuid,
      registrado_en: item.registrado_en,
      control_uuid: item.control_uuid,
      coincide: item.coincide,
      observacion: item.observacion || null,
      foto: item.foto ? await Camara.aBase64(item.foto) : null
    };
  }

  /** El POST pelado. Lo comparten el envio con cola y el envio directo. */
  async function postear(item) {
    return fetch(RUTAS[tipoDe(item)], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(await armarPayload(item))
    });
  }

  /**
   * Envio sin cola, para cuando IndexedDB no esta disponible.
   *
   * Sin base no hay donde encolar, pero eso no puede dejar al inspector sin
   * poder trabajar: si hay senal, el control se manda y listo. Lo unico que se
   * pierde es cargar sin conexion, y eso ya se avisa en pantalla.
   *
   * No hay riesgo para la regla de la cola: no hay cola de la cual sacarlo mal.
   * O el servidor confirmo, o se le dice al inspector que no se guardo.
   */
  async function enviarSinCola(item) {
    const res = await postear(item);
    if (res.status === 201 || res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, motivo: 'sesion_invalida' };
    let motivo = 'rechazada';
    try { motivo = (await res.json()).error || motivo; } catch (e) { /* sin cuerpo */ }
    return { ok: false, motivo };
  }

  async function enviarUno(item) {
    const res = await postear(item);

    if (res.status === 201 || res.status === 200) {
      await DB.borrarDeCola(item.uuid);
      return { ok: true };
    }

    if (res.status === 401) {
      return { ok: false, frenar: true, motivo: 'sesion_invalida' };
    }

    // 400/403/413: el problema es el dato, reintentar no lo arregla.
    if (res.status >= 400 && res.status < 500) {
      let motivo = 'rechazada';
      try { motivo = (await res.json()).error || motivo; } catch (e) { /* sin cuerpo */ }
      await DB.actualizarItem(item.uuid, { estado: 'rechazada', motivo });
      return { ok: false, motivo };
    }

    // 5xx: es el servidor, no el dato. Se reintenta.
    return { ok: false, reintentar: true, motivo: 'servidor' };
  }

  async function sincronizar() {
    if (corriendo) return;
    if (!navigator.onLine) {
      // Con el contador de verdad. Decia "Sin senal - 0" teniendo trabajo
      // encolado, que es justo el numero que el inspector mira para saber si lo
      // que cargo sobrevivio.
      const quedan = await DB.contarCola().catch(() => 0);
      avisar({ tipo: 'sin_conexion', pendientes: quedan });
      return;
    }

    corriendo = true;
    avisar({ tipo: 'sincronizando' });

    let enviadas = 0;
    let fallidas = 0;
    try {
      let cola;
      try {
        cola = await DB.leerCola();
      } catch (e) {
        // Sin IndexedDB no hay cola que sincronizar. Antes esto salia por el
        // catch de afuera sin avisar nada y el estado quedaba en
        // "Sincronizando..." para siempre: el inspector veia la app trabajando
        // en algo que no existia.
        avisar({ tipo: 'sin_base' });
        return;
      }
      const pendientes = cola.filter((i) => i.estado !== 'rechazada');

      for (const item of pendientes) {
        let r;
        try {
          r = await enviarUno(item);
        } catch (e) {
          // fetch que explota = se corto la red en el medio. Queda en la cola.
          avisar({ tipo: 'sin_conexion', pendientes: pendientes.length - enviadas });
          return;
        }

        if (r.ok) { enviadas++; continue; }

        if (r.frenar) {
          avisar({ tipo: 'sesion_vencida', pendientes: pendientes.length - enviadas });
          return;
        }
        fallidas++;
      }

      const quedan = await DB.contarCola();
      avisar({ tipo: 'listo', enviadas, fallidas, pendientes: quedan });
    } finally {
      corriendo = false;
    }
  }

  /**
   * crypto.randomUUID solo existe en contexto seguro (https o localhost). La
   * app entera necesita https igual porque sin eso no hay service worker, pero
   * si alguien la sirve por http en una IP interna esto evita que reviente al
   * guardar: el uuid solo tiene que ser unico, no criptografico.
   */
  function nuevoUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** Agrega una inspeccion a la cola e intenta mandarla si hay senal. */
  async function encolar(datos) {
    const item = {
      ...datos,
      uuid: nuevoUuid(),
      registrado_en: new Date().toISOString(),
      estado: 'pendiente',
      creado_en: Date.now()
    };
    try {
      await DB.encolar(item);
    } catch (e) {
      // Sin IndexedDB no hay cola. Antes esto dejaba al inspector sin poder
      // guardar nada: el navegador no le prestaba memoria y la app se rendia.
      // Si hay senal alcanza con mandarlo derecho.
      avisar({ tipo: 'sin_base' });
      if (!navigator.onLine) throw new Error('sin_memoria_ni_senal');
      const r = await enviarSinCola(item);
      if (!r.ok) throw new Error(r.motivo);
      // Se vuelve a avisar para que el aviso de "sin memoria local" no quede
      // tapado por el de guardado: la limitacion sigue estando.
      avisar({ tipo: 'sin_base' });
      return item.uuid;
    }

    avisar({ tipo: 'encolada', pendientes: await DB.contarCola() });

    // Background Sync reintenta aunque el inspector cierre la app. Donde no
    // este soportado (iOS), queda el reintento al volver online.
    //
    // **Va sin await a proposito, y el try/catch no alcanzaba.**
    // `navigator.serviceWorker.ready` no se resuelve NUNCA si el service worker
    // no llega a activarse: http sin contexto seguro, un error en sw.js, modo
    // privado. No rechaza, se cuelga. Con `await` ahi, encolar() no volvia mas:
    // el control quedaba guardado en la cola pero no se mandaba, no aparecia el
    // aviso, y el boton se quedaba en "Guardando..." para siempre. El inspector
    // no tenia forma de saber si su control existia.
    //
    // Background Sync es una mejora, no puede estar en el camino de guardar.
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready
        .then((reg) => reg.sync.register('yard-sync'))
        .catch(() => { /* sin background sync: se reintenta a mano */ });
    }
    sincronizar();
    return item.uuid;
  }

  window.addEventListener('online', () => sincronizar());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.tipo === 'sincronizar') sincronizar();
    });
  }

  return { encolar, sincronizar, alCambiar };
})();
