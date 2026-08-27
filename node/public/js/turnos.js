'use strict';

/**
 * Los turnos de la playa. Una sola definicion para toda la app: patrullas los
 * usa para agrupar los controles, bahias para saber cuando vence la ronda.
 *
 *   Primer turno    06:00 -> 16:00
 *   Segundo turno   16:00 -> 00:45 del dia siguiente
 *   (sin turno)     00:45 -> 06:00
 *
 * Tres cosas de aca son las que rompen si se hacen a ojo:
 *
 * 1. **El segundo turno cruza la medianoche.** Un control de las 00:30
 *    pertenece a la jornada que arranco AYER a las 16:00. Agrupar por fecha de
 *    calendario hace que a las 00:01 la ronda se de por vencida y el inspector
 *    tenga que rehacerla entera. Por eso `de()` devuelve una clave de jornada
 *    ('2026-08-27-tarde') y no un dia.
 *
 * 2. **Hay un hueco real de 00:45 a 06:00** en el que no trabaja nadie. Ahi
 *    `de()` devuelve el turno que acaba de cerrar con `activo: false`. Decir
 *    "sin controlar" a las 03:00 seria pintar de rojo una ronda que todavia no
 *    empezo.
 *
 * 3. **El primer inspector se queda hasta las 16:45** solapando para el pase de
 *    turno, pero el corte es 16:00: la ronda vence cuando entra el turno nuevo,
 *    no cuando se va el viejo.
 *
 * El corte sale de la operacion. Antes la app partia a las 13:00, lo que
 * mandaba al segundo turno 688 controles del historico (16%) que eran del
 * primero.
 */
const Turnos = (() => {
  const ABRE   = 6 * 60;              // 06:00, entra el primer turno
  const CORTE  = 16 * 60;             // 16:00, entra el segundo
  const CIERRE = 45;                  // 00:45, se va el segundo

  const NOMBRE = { manana: 'Primer turno', tarde: 'Segundo turno' };

  const claveDia = (d) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');

  /** Arma el turno `id` de la jornada que empieza el dia `base`. */
  function armar(base, id, activo) {
    const dia = new Date(base);
    dia.setHours(0, 0, 0, 0);

    const inicio = new Date(dia);
    const fin = new Date(dia);
    if (id === 'manana') {
      inicio.setMinutes(ABRE);
      fin.setMinutes(CORTE);
    } else {
      inicio.setMinutes(CORTE);
      fin.setDate(fin.getDate() + 1);
      fin.setMinutes(CIERRE);
    }

    return { id, nombre: NOMBRE[id], clave: claveDia(dia) + '-' + id, inicio, fin, activo };
  }

  /**
   * El turno al que pertenece un momento.
   *
   * `clave` identifica la jornada: dos momentos con la misma clave son el mismo
   * turno aunque caigan en dias distintos del calendario. `activo` dice si en
   * ese momento hay alguien de turno -- entre 00:45 y 06:00 no lo hay, y
   * devuelve el turno recien cerrado.
   */
  function de(x) {
    const d = new Date(x);
    const min = d.getHours() * 60 + d.getMinutes();

    // Antes de las 00:45 seguimos dentro del segundo turno que empezo ayer.
    if (min < CIERRE) {
      const ayer = new Date(d);
      ayer.setDate(ayer.getDate() - 1);
      return armar(ayer, 'tarde', true);
    }
    // Hueco: cerro el segundo turno de ayer y todavia no entro nadie.
    if (min < ABRE) {
      const ayer = new Date(d);
      ayer.setDate(ayer.getDate() - 1);
      return armar(ayer, 'tarde', false);
    }
    if (min < CORTE) return armar(d, 'manana', true);
    return armar(d, 'tarde', true);
  }

  /** Solo el nombre. Es lo que usa patrullas para el encabezado del grupo. */
  const nombre = (x) => de(x).nombre;

  /** Minutos hasta que venza el turno en curso. Negativo si ya vencio. */
  const restan = (x) => Math.round((de(x || new Date()).fin - new Date()) / 60000);

  /** '3 h 20' / '45 min'. Para el aviso de cuanto queda de ronda. */
  function falta(minutos) {
    if (minutos <= 0) return 'vencida';
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return h ? h + ' h ' + String(m).padStart(2, '0') : m + ' min';
  }

  return { de, nombre, restan, falta, ABRE, CORTE, CIERRE };
})();
