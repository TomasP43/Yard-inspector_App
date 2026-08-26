'use strict';

/**
 * La costura con el backend del tablero de gerencia.
 *
 * **Este tablero no puede calcularse desde el navegador.** Necesita agregados
 * sobre el historico completo -- 4.268 controles en 12 meses, Pareto acumulado,
 * analisis de reincidencia (que paso despues de cada observacion), impacto en
 * la carga por tipo. La API de inspecciones corta en 500 filas por consulta y
 * no tiene endpoints de agregacion.
 *
 * Asi que hay un solo pedido: `GET api/tablero`, que devuelve todo masticado.
 * El contrato completo esta en REQUERIMIENTOS.md (YI-004).
 *
 * Mientras el endpoint no exista, `tools/preview/` define `window.TABLERO` con
 * la misma forma y esto lo usa. Eso permite construir la pantalla, no darla por
 * verificada contra datos reales.
 */
const Datos = (() => {
  /**
   * Trae el tablero.
   *
   * `periodo` es 'anual' o 'mensual'. Va como parametro y no se resuelve del
   * lado del cliente porque el corte cambia todos los agregados, no solo el
   * grafico de arriba: el Pareto de los ultimos 12 meses no es el del mes.
   */
  async function traer(periodo) {
    // Los datos falsos del preview ganan si estan: es la unica forma de ver la
    // pantalla mientras el endpoint no exista.
    if (window.TABLERO) {
      await new Promise((r) => setTimeout(r, 180));
      return window.TABLERO;
    }

    // TODO: reemplazar por el endpoint real cuando exista (ver YI-004).
    //       GET api/tablero?periodo=anual|mensual
    const r = await fetch(`api/tablero?periodo=${encodeURIComponent(periodo)}`, {
      credentials: 'same-origin'
    });
    if (r.status === 401) throw new Error('sesion_invalida');
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  /**
   * Baja lo que se esta viendo como CSV.
   *
   * Se arma en el navegador con lo que ya esta en pantalla, en vez de pedirle
   * un archivo al servidor: lo que se exporta es exactamente lo que se ve, sin
   * riesgo de que el servidor recorte distinto y los numeros no coincidan con
   * los de arriba.
   */
  function exportarCsv(nombre, filas) {
    if (!filas || !filas.length) return;
    const escapar = (v) => {
      const s = String(v == null ? '' : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // Punto y coma, no coma: Excel en es-AR abre con coma decimal y un CSV
    // separado por comas le queda todo en una columna.
    const texto = filas.map((f) => f.map(escapar).join(';')).join('\r\n');

    // BOM para que Excel lea los acentos. Sin el, "Óxido" abre como "Ã“xido".
    const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { traer, exportarCsv };
})();
