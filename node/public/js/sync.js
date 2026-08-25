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

  async function armarPayload(item) {
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

  async function enviarUno(item) {
    const res = await fetch('api/inspecciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(await armarPayload(item))
    });

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
    if (!navigator.onLine) { avisar({ tipo: 'sin_conexion' }); return; }

    corriendo = true;
    avisar({ tipo: 'sincronizando' });

    let enviadas = 0;
    let fallidas = 0;
    try {
      const cola = await DB.leerCola();
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
    await DB.encolar(item);
    avisar({ tipo: 'encolada', pendientes: await DB.contarCola() });

    // Background Sync reintenta aunque el inspector cierre la app. Donde no
    // este soportado (iOS), queda el reintento al volver online.
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('yard-sync');
      } catch (e) { /* sin background sync: se reintenta a mano */ }
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
