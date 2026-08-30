'use strict';

/**
 * El dibujo del vehiculo con los daños marcados.
 *
 * Es el mismo blueprint que la planilla de precarga trae impreso y que el
 * inspector ya marca con un circulo a mano ("MARCAR CON UN CIRCULO LA ZONA
 * DAÑADA", dice el formulario). Se saco de `Checklist control de precarga y
 * recepcion.xlsx` en vez de dibujar uno nuevo: el que lo mira en papel y el que
 * lo mira en la pantalla tienen que ver la misma cosa.
 *
 * **Se marca por sector, no por parte.** Las cuatro vistas del blueprint cubren
 * los seis sectores del formulario, una zona cada una, sin superponerse:
 *
 * | Sector | Vista |
 * |---|---|
 * | Frente | frontal, arriba a la derecha |
 * | Extremo trasero | trasera, abajo a la derecha |
 * | Lateral izquierdo | planta, flanco de arriba |
 * | Lateral derecho | planta, flanco de abajo |
 * | Tren inferior, techo y varios | perfil, arriba a la izquierda |
 * | Interior | ninguna: no se ve desde afuera, va aparte |
 *
 * Marcar la zona y no el punto exacto es a proposito por ahora: son 110 partes
 * y ubicar cada una sobre cuatro vistas es un mapeo largo y facil de errar. La
 * zona ya es lo que el circulo a mano logra. Cuando esten las coordenadas por
 * parte entran en `PUNTOS` sin tocar el resto.
 */
const Vehiculo = (() => {

  /**
   * Un dibujo por modelo.
   *
   * Hoy solo esta el Hilux, que es el unico que la planilla trae. Los demas
   * **no** se dibujan como Hilux: un Corolla con silueta de pick-up hace dudar
   * del resto del papel. Caen en un aviso que lo dice, hasta que lleguen los
   * blueprints de los otros modelos.
   */
  const DIBUJOS = {
    'Hilux': 'img/vehiculos/hilux.png'
  };

  /** Las cuatro vistas del blueprint, en % sobre la imagen. */
  const VISTAS = {
    perfil:     { x: 2,  y: 5,  w: 64, h: 37 },
    frontal:    { x: 67, y: 5,  w: 32, h: 37 },
    plantaSup:  { x: 2,  y: 55, w: 62, h: 21 },
    plantaInf:  { x: 2,  y: 76, w: 62, h: 21 },
    trasera:    { x: 66, y: 55, w: 33, h: 42 }
  };

  const ZONA = {
    'Frente': 'frontal',
    'Extremo trasero': 'trasera',
    'Lateral izquierdo': 'plantaSup',
    'Lateral derecho': 'plantaInf',
    'Tren inferior, techo y varios': 'perfil'
  };

  const dibujoDe = (modelo) => DIBUJOS[modelo] || null;

  /**
   * El diagrama con los sectores marcados.
   *
   * `danos` es la lista de daños con su `grupo`; se cuentan por sector aca
   * adentro para que quien llama no tenga que saber como se agrupa.
   */
  function marcado(modelo, danos, opciones) {
    const op = opciones || {};
    const cuenta = new Map();
    for (const d of danos || []) cuenta.set(d.grupo, (cuenta.get(d.grupo) || 0) + 1);

    const dibujo = dibujoDe(modelo);
    const interior = cuenta.get('Interior') || 0;

    const marcas = Array.from(cuenta.entries())
      .filter(([sector]) => ZONA[sector])
      .map(([sector, n]) => {
        const v = VISTAS[ZONA[sector]];
        return `
          <span class="veh-zona" style="left:${v.x}%;top:${v.y}%;width:${v.w}%;height:${v.h}%"
                title="${esc(sector)}: ${n} ${n === 1 ? 'daño' : 'daños'}">
            <b>${n}</b>
          </span>`;
      }).join('');

    const cuerpo = dibujo
      ? `<div class="veh-lienzo">
           <img src="${esc(op.base || '')}${esc(dibujo)}" alt="Esquema del vehículo">
           ${marcas}
         </div>`
      : `<p class="nota alerta">${ico('octagon-alert', 15)} No tenemos el esquema de ${esc(modelo || 'este modelo')}. Los daños quedan en la lista.</p>`;

    const leyenda = Array.from(cuenta.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sector, n]) => `
        <span class="veh-ref${ZONA[sector] ? '' : ' suelto'}">
          <b>${n}</b>${esc(sector)}
        </span>`).join('');

    return `
      <div class="veh">
        ${cuerpo}
        <div class="veh-refs">${leyenda}</div>
        ${interior && dibujo
          ? `<p class="nota">El interior no se ve en el esquema: ${interior} ${interior === 1 ? 'daño' : 'daños'} ${interior === 1 ? 'está' : 'están'} sólo en la lista.</p>`
          : ''}
      </div>`;
  }

  return { marcado, dibujoDe, VISTAS, ZONA };
})();
