'use strict';

/**
 * El dibujo del vehiculo con los daños marcados.
 *
 * Es lo mismo que el inspector ya hace en papel: la planilla dice "MARCAR CON
 * UN CIRCULO LA ZONA DAÑADA" y trae un dibujo del vehiculo para eso. Aca la
 * zona se marca sola con lo que se cargo.
 *
 * **Se marca por sector, no por parte.** El dibujo trae cinco vistas en cruz y
 * cada sector cae en una, sin superponerse:
 *
 * | Sector | Vista |
 * |---|---|
 * | Frente | frontal, arriba |
 * | Lateral izquierdo | perfil de la izquierda |
 * | Tren inferior, techo y varios | planta, al medio |
 * | Lateral derecho | perfil de la derecha |
 * | Extremo trasero | trasera, abajo |
 * | Interior | ninguna: no se ve desde afuera, va aparte |
 *
 * ⚠ **Cual perfil es cual hay que confirmarlo con la operacion.** Los dos estan
 * dibujados con el frente hacia arriba, y desplegando la caja el flanco
 * izquierdo cae a la izquierda -- pero un lateral espejado marca el lado
 * equivocado del auto, que es peor que no marcar nada.
 *
 * Marcar la zona y no el punto exacto es a proposito por ahora: son 110 partes
 * y ubicar cada una sobre cinco vistas es un mapeo largo y facil de errar. La
 * zona ya es lo que el circulo a mano logra. Cuando esten las coordenadas por
 * parte entran en `PUNTOS` sin tocar el resto.
 */
const Vehiculo = (() => {

  /**
   * Un dibujo por modelo.
   *
   * El que no tenga **no** se dibuja con la silueta de otro: un Corolla como
   * pick-up hace dudar del resto del papel. Cae en un aviso que lo dice.
   *
   * ⚠ Son ilustraciones, no planos tecnicos de Toyota. Alcanzan de sobra para
   * señalar en que zona esta el daño, que es para lo que se usan, pero no son
   * una referencia dimensional y conviene no venderlas como tal.
   */
  const DIBUJOS = {
    'hilux': 'hilux.jpg',
    'sw4': 'sw4.jpg',
    'corolla': 'corolla.jpg',
    'corolla cross': 'corolla-cross.jpg',
    'yaris': 'yaris.jpg',
    'yaris cross': 'yaris-cross.jpg',
    'hiace': 'hiace.jpg',
    'tacoma': 'tacoma.jpg'
  };

  /** Las cinco vistas, en % sobre la imagen. Todos los dibujos usan el mismo molde. */
  const VISTAS = {
    frontal:     { x: 30, y: 1,  w: 40, h: 23 },
    lateralIzq:  { x: 2,  y: 24, w: 30, h: 55 },
    planta:      { x: 33, y: 24, w: 34, h: 55 },
    lateralDer:  { x: 68, y: 24, w: 30, h: 55 },
    trasera:     { x: 30, y: 80, w: 40, h: 19 }
  };

  const ZONA = {
    'Frente': 'frontal',
    'Lateral izquierdo': 'lateralIzq',
    'Tren inferior, techo y varios': 'planta',
    'Lateral derecho': 'lateralDer',
    'Extremo trasero': 'trasera'
  };

  /**
   * Se busca por nombre normalizado, no literal: el modelo llega del sistema de
   * solicitudes y puede venir en mayusculas o con acento. Coincidencia exacta y
   * no "contiene", que si no un "Corolla Cross" entraria por "Corolla".
   */
  function dibujoDe(modelo) {
    const k = Similitud.normalizar(modelo || '');
    return DIBUJOS[k] ? 'img/vehiculos/' + DIBUJOS[k] : null;
  }

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
           <img src="${esc(op.base || '')}${esc(dibujo)}" alt="Esquema del vehículo"
                onerror="this.closest('.veh').classList.add('sin-dibujo')">
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
        ${dibujo ? `<p class="nota alerta veh-falta">${ico('octagon-alert', 15)} No se pudo cargar el esquema. Los daños quedan en la lista.</p>` : ''}
        ${cuerpo}
        <div class="veh-refs">${leyenda}</div>
        ${interior && dibujo
          ? `<p class="nota">El interior no se ve en el esquema: ${interior} ${interior === 1 ? 'daño' : 'daños'} ${interior === 1 ? 'está' : 'están'} sólo en la lista.</p>`
          : ''}
      </div>`;
  }

  return { marcado, dibujoDe, VISTAS, ZONA };
})();
