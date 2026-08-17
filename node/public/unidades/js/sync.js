'use strict';

/**
 * Cola de sincronizacion de inspecciones de unidad.
 *
 * Misma regla que en patrullas, y por la misma razon: **una inspeccion solo
 * sale de la cola cuando el servidor confirma que la guardo.**
 *
 *   201 / 200      -> guardada, se saca de la cola
 *   401            -> sesion vencida: frena todo y avisa, no descarta nada
 *   4xx validacion -> se marca rechazada y se muestra, pero NO se borra:
 *                     que la vea una persona antes de perder trabajo de campo
 *   5xx o red      -> queda encolada, se reintenta
 */
const SyncU = (() => {
  let corriendo = false;
  const oyentes = [];

  const alCambiar = (f) => oyentes.push(f);
  const avisar = (e) => oyentes.forEach((f) => f(e));

  function nuevoUuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  /** Las imagenes viajan como Blob en IndexedDB y se pasan a base64 al enviar. */
  async function armarPayload(item) {
    const danos = [];
    for (const d of item.danos || []) {
      danos.push({
        parte_id: d.parte_id,
        cuadrante: d.cuadrante || 0,
        tipo_dano_id: d.tipo_dano_id || null,
        tipo_nuevo: d.tipo_nuevo || null,
        detalle_nuevo: d.detalle_nuevo || null,
        comentario: d.comentario || null,
        foto: d.foto ? await Camara.aBase64(d.foto) : null
      });
    }
    return {
      uuid: item.uuid,
      unidad_id: item.unidad_id,
      etapa_id: item.etapa_id,
      registrado_en: item.registrado_en,
      resultado: item.resultado,
      observacion: item.observacion || null,
      foto_panoramica: item.foto_panoramica ? await Camara.aBase64(item.foto_panoramica) : null,
      foto_vin: item.foto_vin ? await Camara.aBase64(item.foto_vin) : null,
      firma_inspector: item.firma_inspector ? await Camara.aBase64(item.firma_inspector) : null,
      danos
    };
  }

  async function enviarUno(item) {
    const res = await fetch('../api/unidades/inspecciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(await armarPayload(item))
    });

    if (res.status === 201 || res.status === 200) {
      await DBU.borrarDeCola(item.uuid);
      return { ok: true };
    }
    if (res.status === 401) return { ok: false, frenar: true };
    if (res.status >= 400 && res.status < 500) {
      let motivo = 'rechazada';
      let detalle = null;
      try { const j = await res.json(); motivo = j.error || motivo; detalle = j.detalle || null; } catch (e) { /* sin cuerpo */ }
      await DBU.actualizarItem(item.uuid, { estado: 'rechazada', motivo, detalle });
      return { ok: false, motivo };
    }
    return { ok: false, reintentar: true };
  }

  async function sincronizar() {
    if (corriendo) return;
    if (!navigator.onLine) { avisar({ tipo: 'sin_conexion', pendientes: await DBU.contarCola() }); return; }

    corriendo = true;
    avisar({ tipo: 'sincronizando' });
    let enviadas = 0;
    let fallidas = 0;

    try {
      const cola = (await DBU.leerCola()).filter((i) => i.estado !== 'rechazada');
      for (const item of cola) {
        let r;
        try {
          r = await enviarUno(item);
        } catch (e) {
          // Se corto la red en el medio: queda todo en la cola.
          avisar({ tipo: 'sin_conexion', pendientes: await DBU.contarCola() });
          return;
        }
        if (r.ok) { enviadas++; continue; }
        if (r.frenar) { avisar({ tipo: 'sesion_vencida', pendientes: await DBU.contarCola() }); return; }
        fallidas++;
      }
      avisar({ tipo: 'listo', enviadas, fallidas, pendientes: await DBU.contarCola() });
    } finally {
      corriendo = false;
    }
  }

  async function encolar(datos) {
    const item = { ...datos, uuid: nuevoUuid(), estado: 'pendiente', creado_en: Date.now() };
    await DBU.encolar(item);
    avisar({ tipo: 'encolada', pendientes: await DBU.contarCola() });

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('yard-unidades-sync');
      } catch (e) { /* sin background sync: se reintenta al volver online */ }
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

  return { encolar, sincronizar, alCambiar, nuevoUuid };
})();
