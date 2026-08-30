'use strict';

/**
 * La hoja por unidad, para imprimir.
 *
 * Es el `LOGISTIC'S CHECKLIST` de `Checklist control de precarga y
 * recepcion.xlsx` (hojas UNID1..UNID8), que hoy se imprime en blanco y se llena
 * a mano. Aca sale con lo que la app ya registro.
 *
 * **Lo que el papel tiene y esto no:**
 *
 * - La grilla de 95 partes con su numero y la leyenda de codigos de daño. Esa
 *   grilla existe para que alguien busque el codigo y lo escriba; con la hoja
 *   generada el nombre ya esta puesto, asi que ocupa una carilla para nada.
 * - Los codigos numericos. Se imprime el nombre de la parte y del daño, que es
 *   lo que se entiende sin tabla al lado.
 *
 * **Lo que se conserva en blanco:** el bloque de RECEPCION DE DESTINO. No lo
 * llena precarga: lo va a llenar el modulo de descarga. Dejarlo afuera obligaria
 * a rehacer la hoja cuando ese modulo entre.
 *
 * **Donde el formulario tiene los recuadros de firma van las fotos del daño.**
 * Es lo que se decidio con la operacion: en la etapa de precarga esos recuadros
 * quedaban vacios, y la foto es la prueba que si existe en este momento.
 *
 * ⚠ Queda una pregunta abierta: si en destino igual hay que firmar sobre el
 * papel, hacen falta los recuadros de vuelta. Ver YI-013.
 */
const Hoja = (() => {

  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/'
         + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };

  const campo = (etiqueta, valor, ancho) => `
    <div class="hj-campo" style="grid-column:span ${ancho || 1}">
      <span>${esc(etiqueta)}</span>
      <b>${esc(valor == null || valor === '' ? '—' : valor)}</b>
    </div>`;

  /** Un renglon en blanco, del largo que se le pida. Lo llena una lapicera. */
  const enBlanco = (etiqueta, ancho) => `
    <div class="hj-campo vacio" style="grid-column:span ${ancho || 1}">
      <span>${esc(etiqueta)}</span>
      <b></b>
    </div>`;

  /**
   * La hoja de una unidad.
   *
   * `s` es la solicitud y `u` la unidad con su `inspeccion`. `orden` es el
   * numero de bajada real, que se calcula afuera porque depende de las otras
   * unidades de la solicitud.
   */
  function unidad(s, u, orden) {
    const insp = u.inspeccion || {};
    const danos = insp.danos || [];
    const desvio = orden && u.orden_solicitado && orden !== u.orden_solicitado;

    const filas = danos.length
      ? danos.map((d, i) => {
          const p = Precarga.parte(d.parte_id) || {};
          return `
            <tr>
              <td class="n">${i + 1}</td>
              <td>${esc(p.grupo || '—')}</td>
              <td class="fuerte">${esc(Precarga.nombreParte(d.parte_id))}</td>
              <td>${esc(Precarga.nombreDano(d.tipo_dano_id))}</td>
              <td class="obs">${esc(d.comentario || '')}</td>
            </tr>`;
        }).join('')
      : `<tr><td colspan="5" class="sin">Sin daños. La unidad se revisó y no tenía observaciones.</td></tr>`;

    const conFoto = danos.filter((d) => d.foto);

    return `
      <article class="hoja">

        <header class="hj-cab">
          <div>
            <b>LOGISTIC'S CHECKLIST</b>
            <span>Control de precarga · TTFA</span>
          </div>
          <div class="hj-fecha">
            <span>FECHA</span>
            <b>${esc(fmt(insp.escaneado_en || insp.registrado_en))}</b>
          </div>
        </header>

        <section class="hj-datos">
          ${campo('Chasis (VIN)', u.vin, 2)}
          ${campo('Modelo', u.modelo)}
          ${campo('Katashiki', u.katashiki)}
          ${campo('S.O.', u.so)}
          ${campo('Solicitud', s.codigo)}
          ${campo('Equipo', s.equipo)}
          ${campo('Bahía', s.bahia)}
          ${campo('Transportista', s.transportista)}
          ${campo('Destino', u.destino || s.destino, 2)}
          ${campo('Orden solicitado', u.orden_solicitado)}
          ${campo('Orden real de bajada', orden ? orden + (desvio ? ' · fuera de orden' : '') : '—')}
        </section>

        <section class="hj-bloque">
          <h2>Observación de origen</h2>
          <table class="hj-tabla">
            <thead>
              <tr><th class="n">#</th><th>Sector</th><th>Parte</th><th>Tipo de daño</th><th>Comentario</th></tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
        </section>

        <section class="hj-bloque hj-esquema">
          <h2>Zona dañada</h2>
          ${Vehiculo.marcado(u.modelo, danos.map((d) => ({ grupo: (Precarga.parte(d.parte_id) || {}).grupo })))}
        </section>

        ${conFoto.length ? `
        <section class="hj-bloque">
          <h2>Fotos del daño</h2>
          <div class="hj-fotos">
            ${conFoto.map((d, i) => `
              <figure>
                <img src="${esc(d.foto)}" alt="">
                <figcaption>${i + 1} · ${esc(Precarga.nombreParte(d.parte_id))}</figcaption>
              </figure>`).join('')}
          </div>
        </section>` : ''}

        <section class="hj-bloque hj-destino">
          <h2>Recepción de destino</h2>
          <p class="hj-nota">Lo completa quien recibe. Precarga no lo llena.</p>
          <div class="hj-datos">
            ${enBlanco('Fecha')}
            ${enBlanco('Hora')}
            ${enBlanco('Observación', 2)}
          </div>
        </section>

        <footer class="hj-pie">
          <span>${esc(s.codigo || '')} · ${esc(u.vin)}</span>
          <span>Generado por Yard Inspector</span>
        </footer>

      </article>`;
  }

  return { unidad };
})();
