'use strict';

/**
 * La hoja por unidad, para imprimir.
 *
 * Es el `LOGISTIC'S CHECKLIST` de `Checklist control de precarga y
 * recepcion.xlsx` (hojas UNID1..UNID8) **con su mismo diseño**: hoy se imprime
 * en blanco y se llena a mano, y esto sale con lo que la app ya registro. Quien
 * lo recibe en destino tiene que reconocer el papel de siempre, no uno nuevo.
 *
 * El molde del formulario, tal cual, es:
 *
 * ```
 * LOGISTIC'S CHECKLIST                    | FECHA
 * FURLONG FLOTA | n | CHASIS | vin        | SECTOR DAÑADO
 * MODELO | ...  | MOTOR N°: | ...         |
 * LUGAR DE CARGA | ... | FC | ...         |   [dibujo del vehiculo]
 * ---------------------------------------- |
 * OBSERVACION DE ORIGEN                   | MARCAR CON UN CIRCULO
 *   AREA / DAÑO / GRAVEDAD                |   LA ZONA DAÑADA
 * RECEPCION DE DESTINO                    |
 *   FECHA / HORA / OBSERVACION            |   [recuadros de firma]
 * ---------------------------------------------------------------
 * SECT. | Nº | DAÑO | DETALLE   (la grilla de partes, en 3 columnas)
 * ---------------------------------------------------------------
 * TIPOS DE DAÑO                           | GRAVEDAD
 * ```
 *
 * **Tres cosas cambian, y las tres estan forzadas por el dato:**
 *
 * 1. `OBSERVACION DE ORIGEN` son tres renglones sueltos --area, daño,
 *    gravedad-- porque el papel asume un daño por hoja. Una unidad puede tener
 *    varios, asi que ahi va la tabla.
 * 2. La leyenda de codigos es la de los **14 tipos que la operacion usa**, no la
 *    de los 28 codigos numerados del impreso. Imprimir codigos que ya nadie
 *    carga es imprimir un fosil.
 * 3. Los recuadros de firma llevan **las fotos del daño**. En precarga quedaban
 *    vacios y la foto es la prueba que si existe en ese momento. ⚠ Si en destino
 *    igual hay que firmar sobre el papel, vuelven los recuadros. Ver YI-013.
 *
 * `RECEPCION DE DESTINO` queda en blanco: no lo llena precarga, lo va a llenar
 * el modulo de descarga. Y la grilla de partes se conserva aunque la app ya
 * escriba el nombre, porque en destino se marca a mano sobre ella.
 */
const Hoja = (() => {

  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return String(d.getDate()).padStart(2, '0') + '/'
         + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };

  const val = (v) => esc(v == null || v === '' ? '' : v);

  /** Una celda del encabezado: etiqueta a la izquierda, valor en su recuadro. */
  const par = (etiqueta, valor) => `
    <div class="hj-par">
      <span>${esc(etiqueta)}</span>
      <b>${val(valor)}</b>
    </div>`;

  /**
   * La grilla de partes del formulario, en tres columnas.
   *
   * Se conserva aunque la app ya escriba el nombre del daño: **en destino se
   * marca a mano sobre esta grilla**, que es para lo que esta. Va agrupada por
   * sector y ordenada por numero adentro de cada uno -- el impreso las tiene en
   * un orden anatomico que no se puede buscar.
   */
  function grillaPartes() {
    // Van TODAS, no solo las que tienen numero Furlong. Las 16 que se sumaron
    // del catalogo de AppSheet --opticas, airbags, cinturones-- no lo tienen, y
    // dejarlas afuera significaria que en destino no se puede marcar un airbag
    // dañado porque no figura en la lista. Se imprimen con el Nº vacio.
    const partes = (Precarga.catalogo().partes || []);
    const orden = ['Frente', 'Lateral izquierdo', 'Lateral derecho',
                   'Extremo trasero', 'Tren inferior, techo y varios', 'Interior'];

    const filas = [];
    for (const sector of orden) {
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

    const cuerpo = (col) => col.map((f) => `
      <tr>
        <td class="sect">${esc(f.sector)}</td>
        <td class="num">${f.num}</td>
        <td class="cod"></td>
        <td class="det">${esc(f.nombre)}</td>
      </tr>`).join('');

    return `
      <div class="hj-grilla">
        ${cols.map((col) => `
          <table>
            <thead><tr><th>SECT.</th><th>Nº</th><th>DAÑO</th><th>DETALLE</th></tr></thead>
            <tbody>${cuerpo(col)}</tbody>
          </table>`).join('')}
      </div>`;
  }

  /** Las dos leyendas del pie, como en el impreso. */
  function leyendas() {
    const tipos = (Precarga.catalogo().tipos_dano || []);
    return `
      <div class="hj-leyendas">
        <section>
          <h3>Tipos de daño</h3>
          <ul>${tipos.map((t) => `<li><i>${String(t.id).padStart(2, '0')}</i>${esc(t.nombre)}</li>`).join('')}</ul>
        </section>
        <section>
          <h3>Código de gravedad <small>· no se registra en precarga</small></h3>
          <ul class="grav">
            <li><i>0</i>Sin excepción</li>
            <li><i>1</i>Hasta 2,5 cm</li>
            <li><i>2</i>Más de 2,5 y hasta 7,5 cm</li>
            <li><i>3</i>Más de 7,5 y hasta 15 cm</li>
            <li><i>4</i>Más de 15 y hasta 30 cm</li>
            <li><i>5</i>Más de 30 cm</li>
            <li><i>6</i>Sustitución / daño severo</li>
            <li><i>7</i>Faltante</li>
          </ul>
        </section>
      </div>`;
  }

  /** La hoja de una unidad. `orden` es el numero real de bajada. */
  function unidad(s, u, orden) {
    const insp = u.inspeccion || {};
    const danos = insp.danos || [];
    const desvio = orden && u.orden_solicitado && orden !== u.orden_solicitado;
    const conFoto = danos.filter((d) => d.foto);

    const observacion = danos.length
      ? `<table class="hj-danos">
           <thead><tr><th class="n">#</th><th>Área</th><th>Parte</th><th>Daño</th><th>Detalle</th></tr></thead>
           <tbody>${danos.map((d, i) => `
             <tr>
               <td class="n">${i + 1}</td>
               <td>${esc((Precarga.parte(d.parte_id) || {}).grupo || '')}</td>
               <td class="fuerte">${esc(Precarga.nombreParte(d.parte_id))}</td>
               <td>${esc(Precarga.nombreDano(d.tipo_dano_id))}</td>
               <td class="det">${esc(d.comentario || '')}</td>
             </tr>`).join('')}</tbody>
         </table>`
      : `<p class="hj-sin">SIN EXCEPCIONES · la unidad se revisó y no tenía daños</p>`;

    // Donde el impreso tiene los cuatro recuadros de firma. Si no hay fotos,
    // quedan los recuadros: la hoja tiene que servir igual para firmarla.
    const firmas = conFoto.length
      ? `<div class="hj-fotos">
           ${conFoto.map((d, i) => `
             <figure>
               <img src="${esc(d.foto)}" alt="">
               <figcaption>${i + 1} · ${esc(Precarga.nombreParte(d.parte_id))}</figcaption>
             </figure>`).join('')}
         </div>`
      : `<div class="hj-firmas">
           <div><span>Firma y sello de Toyota</span></div>
           <div><span>Firma y sello del receptor</span></div>
           <div><span>Firma y aclaración del inspector de Furlong</span></div>
           <div><span>Firma y aclaración del chofer</span></div>
         </div>`;

    return `
      <article class="hoja">

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

            <section class="hj-caja">
              <h2>Recepción de destino</h2>
              <p class="hj-nota">La completa quien recibe. Precarga no la llena.</p>
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
              ${Vehiculo.marcado(u.modelo, danos.map((d) => ({ grupo: (Precarga.parte(d.parte_id) || {}).grupo })))}
              <p class="hj-pie-dibujo">Marcar con un círculo la zona dañada</p>
            </section>
            ${firmas}
          </div>

        </div>

        <section class="hj-caja hj-ref">
          <h2>Partes</h2>
          ${grillaPartes()}
        </section>

        ${leyendas()}

        <footer class="hj-pie">
          <span>${esc(s.codigo || '')} · ${esc(u.vin)}</span>
          <span>Yard Inspector · TTFA</span>
        </footer>

      </article>`;
  }

  return { unidad };
})();
