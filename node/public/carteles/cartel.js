'use strict';

/**
 * Arma los carteles que se pegan en cada bahia.
 *
 * Cada cartel lleva el numero grande, el QR con el token, y la instruccion.
 * Nada mas: el cartel **no es un formulario**, es el ancla fisica. El registro
 * vive en la app.
 *
 * **El QR lleva solo el token, no una URL.** Si llevara una URL, escanearlo con
 * la camara del telefono abriria la app por afuera del gate y el bloqueo de
 * "sin escanear no se carga" seria decorativo. Con token pelado, la camara del
 * sistema muestra un texto sin sentido y la unica puerta es la app.
 *
 * **Nada se imprime sin verificar.** Un QR mal generado se ve igual que uno
 * bueno -- son cuadraditos negros -- y el error aparecería recién con el
 * sticker pegado en la playa y el inspector sin poder trabajar. Asi que cada
 * codigo se lee de vuelta con el mismo `BarcodeDetector` que usa la app, y el
 * boton de imprimir queda bloqueado hasta que los seis pasen.
 */
(() => {

  const $ = (s) => document.querySelector(s);
  const estado = $('#estado');
  const hojas = $('#hojas');
  const btn = $('#imprimir');

  const decir = (msg, clase) => {
    estado.innerHTML = msg;
    estado.className = 'aviso' + (clase ? ' ' + clase : '');
  };

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * Lee un SVG de QR con la camara-de-mentira: se rasteriza a canvas y se le
   * pasa al detector. Es el mismo motor que corre en el telefono del inspector,
   * asi que si lee acá, lee allá.
   */
  async function leer(svgTexto, detector) {
    const blob = new Blob([svgTexto], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.width = 400;
      img.height = 400;
      await new Promise((ok, mal) => {
        img.onload = ok;
        img.onerror = () => mal(new Error('no se pudo rasterizar el QR'));
        img.src = url;
      });
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 400;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 400, 400);
      g.drawImage(img, 0, 0, 400, 400);
      const codigos = await detector.detect(c);
      return codigos.length ? (codigos[0].rawValue || '').trim() : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function pintar(bahias) {
    hojas.innerHTML = bahias.map((b) => `
      <section class="cartel">
        <span class="rotulo">Control de bahía</span>
        <p class="numero">${esc(b.codigo)}</p>
        <p class="nombre">${esc(b.nombre || 'Bahía ' + b.codigo)}</p>
        <div class="qr" data-qr="${esc(b.token)}">${QR.svg(b.token, 300)}</div>
        <p class="instruccion">
          Abrí <b>Yard Inspector</b>, entrá en <b>Control de bahías</b>,
          tocá esta bahía y escaneá este código.
        </p>
        <p class="pie">${esc(b.token)}</p>
      </section>`).join('');
  }

  /**
   * Dos verificaciones, y la impresion depende de las dos.
   *
   * 1. **Autoprueba del codificador**, siempre. Corre vectores fijos cuyas
   *    huellas se calcularon con este mismo codigo despues de validarlo contra
   *    un decodificador real. Si alguien lo toca y cambia un modulo, no
   *    imprime.
   *
   * 2. **Lectura de verdad**, cuando el navegador puede. `BarcodeDetector`
   *    existe en Chrome de Android pero **no en Chrome de escritorio sobre
   *    Windows**, que es justo desde donde se imprime. Por eso no puede ser la
   *    unica: si fuera obligatoria, el boton no se habilitaria nunca en la
   *    maquina que tiene la impresora.
   */
  async function verificar(bahias) {
    const fallas = QR.autoprueba();
    if (fallas.length) {
      decir('<b>El generador de QR no pasa su propia prueba. No se imprime nada.</b><br>'
        + fallas.map((f) => `<code>${esc(f.texto)}</code>: se esperaba `
          + `<code>${esc(f.esperado)}</code> y dio <code>${esc(f.obtenido)}</code>`).join('<br>'), 'mal');
      return;
    }

    let leidos = 0;
    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const malos = [];
      for (const b of bahias) {
        const svg = $(`[data-qr="${b.token}"]`).innerHTML;
        let leido = null;
        try { leido = await leer(svg, detector); } catch (e) { /* queda en null */ }
        if (leido === b.token) leidos++;
        else {
          malos.push(`bahía ${b.codigo}: se esperaba <code>${esc(b.token)}</code> y se leyó `
            + (leido === null ? '<b>nada</b>' : `<code>${esc(leido)}</code>`));
        }
      }
      if (malos.length) {
        decir('<b>Los códigos no se leen. No se imprime nada.</b><br>' + malos.join('<br>'), 'mal');
        return;
      }
    }

    btn.disabled = false;
    decir(`<b>${bahias.length} carteles listos.</b> El generador pasó sus vectores de prueba`
      + (leidos
        ? `, y los ${leidos} códigos se leyeron de vuelta con la cámara de este navegador.`
        : '. Este navegador no puede leer QR, así que la lectura real no se corrió acá; '
          + 'la prueba definitiva es escanear un cartel impreso con el teléfono.')
      + ' Imprimir en A4, una hoja por bahía.', 'bien');
  }

  async function arrancar() {
    try {
      const r = await fetch('../api/bahias?turno=carteles', { credentials: 'same-origin' });
      if (r.status === 401) { decir('Sesión vencida. Volvé a entrar y recargá.', 'mal'); return; }
      if (!r.ok) throw new Error('http ' + r.status);
      const d = await r.json();

      // Solo las que se patrullan: la 1 y la 2 existen pero no llevan cartel.
      const bahias = (d.bahias || []).filter((b) => b.activo !== false && b.token);
      if (!bahias.length) { decir('No hay bahías activas con token.', 'mal'); return; }

      pintar(bahias);
      decir('Verificando que los códigos se lean…');
      await verificar(bahias);
    } catch (e) {
      decir('No se pudieron traer las bahías: ' + esc(e.message), 'mal');
    }
  }

  btn.addEventListener('click', () => window.print());
  arrancar();
})();
