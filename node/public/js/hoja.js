'use strict';

/**
 * Las hojas para imprimir del legajo de precarga.
 *
 * Es el `LOGISTIC'S CHECKLIST` de `Checklist control de precarga y
 * recepcion.xlsx` (hojas UNID1..UNID8) **con su mismo diseño**: hoy se imprime
 * en blanco y se llena a mano, y esto sale con lo que la app ya registro. Quien
 * lo recibe en destino tiene que reconocer el papel de siempre, no uno nuevo.
 *
 * **Son dos hojas distintas, y esa es la diferencia con el impreso:**
 *
 * | Hoja | Cuantas |
 * |---|---|
 * | `unidad()` — el registro de un VIN | una por unidad |
 * | `referencia()` — la grilla de partes y las leyendas | **una por camion** |
 *
 * En el formulario impreso las dos cosas viven en la misma hoja, y eso hacia que
 * la grilla --164 mm, el 58% de una carilla-- se repitiera identica ocho veces
 * por camion, empujando cada unidad a una segunda carilla que quedaba casi
 * vacia. Separadas, un camion de ocho unidades pasa de 16 carillas a 9.
 *
 * **Tres cosas cambian respecto del papel, y las tres estan forzadas por el
 * dato:**
 *
 * 1. `OBSERVACION DE ORIGEN` son tres renglones sueltos --area, daño,
 *    gravedad-- porque el papel asume un daño por hoja. Una unidad puede tener
 *    varios, asi que ahi va la tabla.
 * 2. La leyenda de codigos es la de los **14 tipos que la operacion usa**, no la
 *    de los 28 codigos numerados del impreso. Imprimir codigos que ya nadie
 *    carga es imprimir un fosil.
 * 3. La grilla lleva **las 110 partes**, no las 95 del impreso. Las 16 que se
 *    sumaron del catalogo de AppSheet --opticas, airbags, cinturones-- no tienen
 *    numero Furlong y van con el Nº vacio.
 *
 * `RECEPCION DE DESTINO` queda en blanco y **compacto**: no lo llena precarga ni
 * una lapicera, lo va a llenar la app de descarga. Por eso el lugar que se
 * libero no fue a renglones para escribir a mano sino a **las fotos**, que son
 * la prueba de lo que se encontro y hasta ahora eran miniaturas.
 */
const Hoja = (() => {

  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/'
         + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };

  const val = (v) => esc(v == null || v === '' ? '' : v);

  /** Una celda del formulario: etiqueta sobre franja, valor en su recuadro. */
  const par = (etiqueta, valor) => `
    <div class="hj-par">
      <span>${esc(etiqueta)}</span>
      <b>${val(valor)}</b>
    </div>`;

  const SECTORES = ['Frente', 'Lateral izquierdo', 'Lateral derecho',
                    'Extremo trasero', 'Tren inferior, techo y varios', 'Interior'];

  // ------------------------------------------------------ hoja de la unidad

  /**
   * El registro de una unidad, en **una sola carilla**.
   *
   * `orden` es el numero real de bajada; se calcula afuera porque depende de las
   * otras unidades de la solicitud.
   */
  function unidad(s, u, orden) {
    const insp = u.inspeccion || {};
    const danos = insp.danos || [];
    const desvio = orden && u.orden_solicitado && orden !== u.orden_solicitado;
    const conFoto = danos.filter((d) => d.foto);

    const observacion = danos.length
      ? `<table class="hj-danos">
           <thead><tr><th class="n">#</th><th class="cod">CÓDIGO</th><th>Parte</th><th>Daño</th><th class="tam">Tamaño</th><th>Detalle</th></tr></thead>
           <tbody>${danos.map((d, i) => `
             <tr>
               <td class="n">${i + 1}</td>
               <td class="cod">${Danos.codigoAiag(d) || '<i>—</i>'}</td>
               <td class="fuerte">${esc(Danos.nombreParte(d.parte_id))}</td>
               <td>${esc(Danos.nombreDano(d.tipo_dano_id))}</td>
               <td class="tam">${esc(Danos.gravedadCorta(d.gravedad) || '—')}</td>
               <td class="det">${esc(d.comentario || '')}</td>
             </tr>`).join('')}</tbody>
         </table>`
      : `<p class="hj-sin">SIN EXCEPCIONES · la unidad se revisó y no tenía daños</p>`;

    return `
      <article class="hoja hoja-unidad">

        <header class="hj-cab">
          <b>LOGISTIC'S CHECKLIST</b>
          <div class="hj-par"><span>Fecha</span><b>${esc(fmt(insp.escaneado_en || insp.registrado_en))}</b></div>
        </header>

        <section class="hj-ident">
          ${par('Furlong flota', s.equipo)}
          ${par('Chasis', u.vin)}
          ${par('Modelo', u.katashiki || u.modelo)}
          ${par('Motor N°', '')}
          ${par('Lugar de carga', 'TASA')}
          ${par('FC', s.codigo)}
          ${par('Bahía', s.bahia)}
          ${par('Destino', u.destino || s.destino)}
          ${par('Orden solicitado', u.orden_solicitado)}
          ${par('Orden real de bajada', orden ? orden + (desvio ? '  (fuera de orden)' : '') : '')}
        </section>

        <div class="hj-medio">
          <div class="hj-izq">
            <section class="hj-caja">
              <h2>Observación de origen</h2>
              ${observacion}
            </section>

            <section class="hj-caja hj-recepcion">
              <h2>Recepción de destino</h2>
              <p class="hj-nota">La completa la app de descarga.</p>
              <div class="hj-blanco">
                <div><span>Fecha</span><i></i></div>
                <div><span>Hora</span><i></i></div>
                <div class="ancho"><span>Observación</span><i></i></div>
              </div>
            </section>
          </div>

          <div class="hj-der">
            <section class="hj-caja">
              <h2>Sector dañado</h2>
              ${Vehiculo.marcado(u.modelo, danos.map((d) => ({ grupo: (Danos.parte(d.parte_id) || {}).grupo })))}
              <p class="hj-pie-dibujo">Marcar con un círculo la zona dañada</p>
            </section>
          </div>
        </div>

        ${conFoto.length ? `
        <section class="hj-caja hj-caja-fotos">
          <h2>Fotos del daño</h2>
          <div class="hj-fotos">
            ${conFoto.map((d, i) => `
              <figure>
                <img src="${esc(d.foto)}" alt="">
                <figcaption><b>${i + 1}</b> ${esc(Danos.nombreParte(d.parte_id))} · ${esc(Danos.nombreDano(d.tipo_dano_id))}${Danos.codigoAiag(d) ? ` <b class="hj-cod">${Danos.codigoAiag(d)}</b>` : ''}${d.foto_calidad && d.foto_calidad.aviso ? ` <i class="hj-foto-aviso">${esc(Camara.TEXTO_AVISO[d.foto_calidad.aviso] || '').toLowerCase()}</i>` : ''}</figcaption>
              </figure>`).join('')}
          </div>
        </section>` : ''}

        <footer class="hj-pie">
          <span>${esc(s.codigo || '')} · ${esc(u.vin)}</span>
          <span>Yard Inspector · TTFA</span>
        </footer>

      </article>`;
  }

  // -------------------------------------------------- hoja de referencia

  /**
   * La grilla de partes y las leyendas. **Una sola por camion.**
   *
   * Es identica para todas las unidades, asi que repetirla en cada hoja era
   * imprimir ocho veces lo mismo. Va adelante del legajo.
   */
  function referencia(s) {
    const partes = Danos.catalogo().partes || [];
    // Ordenados por codigo, que es como se busca en una leyenda: el inspector
    // tiene el numero y quiere el nombre. Los sin codigo van al final.
    const tipos = (Danos.catalogo().tipos_dano || []).slice()
      .sort((a, b) => (a.aiag == null) - (b.aiag == null) || a.aiag - b.aiag);

    const filas = [];
    for (const sector of SECTORES) {
      // Las 16 que vinieron del catalogo de AppSheet no tienen numero Furlong y
      // van al final de su sector, con el Nº vacio.
      const del = partes.filter((p) => p.grupo === sector)
        .sort((a, b) => (a.id >= 1000) - (b.id >= 1000) || a.id - b.id);
      del.forEach((p, i) => filas.push({
        sector: i === 0 ? sector : '',
        num: p.id < 1000 ? p.id : '',
        nombre: p.nombre
      }));
    }

    const porCol = Math.ceil(filas.length / 3);
    const cols = [filas.slice(0, porCol), filas.slice(porCol, porCol * 2), filas.slice(porCol * 2)];

    return `
      <article class="hoja hoja-ref">

        <header class="hj-cab">
          <b>REFERENCIA DE PARTES Y DAÑOS</b>
          <div class="hj-par"><span>Equipo</span><b>${val(s.equipo)}</b></div>
        </header>

        <p class="hj-nota hj-ref-nota">
          Una por camión: es la misma para todas las unidades del viaje.
          ${esc(s.codigo || '')} · bahía ${esc(s.bahia || '—')} · ${esc(s.destino || '')}
        </p>

        <div class="hj-grilla">
          ${cols.map((col) => `
            <table>
              <thead><tr><th>SECT.</th><th>Nº</th><th>DAÑO</th><th>DETALLE</th></tr></thead>
              <tbody>${col.map((f) => `
                <tr>
                  <td class="sect">${esc(f.sector)}</td>
                  <td class="num">${f.num}</td>
                  <td class="cod"></td>
                  <td class="det">${esc(f.nombre)}</td>
                </tr>`).join('')}</tbody>
            </table>`).join('')}
        </div>

        <p class="hj-nota hj-cod-nota">
          <b>El código son cinco dígitos: área + tipo + tamaño.</b>
          El área es el Nº de la parte de esta grilla, el tipo sale de la lista
          de abajo y el tamaño del último dígito. <i>Abollado de 10 cm en la
          puerta delantera izquierda</i> es <b>10043</b>.
        </p>

        <div class="hj-leyendas">
          <section>
            <h3>Tipos de daño</h3>
            <ul>${tipos.map((t) => `<li><i>${t.aiag == null ? '··' : String(t.aiag).padStart(2, '0')}</i>${esc(t.nombre)}${t.aiag == null ? ' <small>(sin código)</small>' : ''}</li>`).join('')}</ul>
          </section>
          <section>
            <h3>Tamaño del daño <small>· el 5.º dígito</small></h3>
            <ul class="grav">
              ${(Danos.catalogo().gravedades || []).map((g) => `<li><i>${g.id}</i>${esc(g.nombre)}</li>`).join('')}
            </ul>
          </section>
        </div>

        <footer class="hj-pie">
          <span>${esc(s.codigo || '')}</span>
          <span>Yard Inspector · TTFA</span>
        </footer>

      </article>`;
  }

  // ------------------------------------------------------------- legajo

  /**
   * El legajo del camion: la referencia adelante y una hoja por unidad bajada.
   *
   * Es lo que se imprime de verdad -- el papel viaja con el equipo, no con cada
   * auto suelto. Las unidades sin bajar no tienen hoja: no hay nada que
   * registrar de ellas todavia.
   */
  function legajo(s, orden) {
    const bajadas = (s.unidades || [])
      .filter((u) => u.inspeccion)
      .sort((a, b) => (orden.get(a.vin) || 0) - (orden.get(b.vin) || 0));

    if (!bajadas.length) return '<p class="nota centro">Todavía no se bajó ninguna unidad de esta solicitud.</p>';

    return referencia(s) + bajadas.map((u) => unidad(s, u, orden.get(u.vin))).join('');
  }

  return { unidad, referencia, legajo };
})();
