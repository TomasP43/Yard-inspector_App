'use strict';

/**
 * Cartelito de "esto es una demo".
 *
 * Se inyecta solo en la copia de `.preview/`, que es la que se publica en
 * GitHub Pages. **La app real nunca lo incluye**: no esta en node/public/.
 *
 * Existe porque el sitio publicado se ve identico al de produccion, y alguien
 * podria mirar el tablero y sacar conclusiones de numeros inventados. Que
 * quede dicho en pantalla, no solo en el README.
 */
(() => {
  const CLAVE = 'yard-demo-visto';
  try { if (sessionStorage.getItem(CLAVE)) return; } catch (e) { /* modo privado */ }

  const css = `
    .demo-aviso {
      position: fixed;
      left: 12px;
      bottom: 12px;
      z-index: 9999;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(420px, calc(100vw - 24px));
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid rgba(240, 162, 28, .45);
      background: #1d1a12;
      color: #f0d9a8;
      font: 12px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
    }
    .demo-aviso b { color: #f0a21c; font-weight: 600; }
    .demo-aviso a { color: inherit; text-decoration: underline; }
    .demo-aviso button {
      flex: 0 0 auto;
      border: 0;
      background: none;
      color: inherit;
      opacity: .6;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
    }
    .demo-aviso button:hover { opacity: 1; }
    /* En el telefono la barra de pestanas ocupa el borde de abajo. */
    @media (max-width: 720px) { .demo-aviso { bottom: 86px; } }
  `;

  const estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  const caja = document.createElement('div');
  caja.className = 'demo-aviso';
  caja.innerHTML =
    '<span><b>Demo.</b> Los datos son inventados: no son controles reales de la playa. ' +
    '<a href="https://github.com/TomasP43/Yard-inspector_App" target="_blank" rel="noopener">Ver el repo</a></span>' +
    '<button type="button" aria-label="Cerrar">&times;</button>';

  caja.querySelector('button').addEventListener('click', () => {
    caja.remove();
    try { sessionStorage.setItem(CLAVE, '1'); } catch (e) { /* modo privado */ }
  });

  const poner = () => document.body.appendChild(caja);
  if (document.body) poner();
  else document.addEventListener('DOMContentLoaded', poner);
})();
