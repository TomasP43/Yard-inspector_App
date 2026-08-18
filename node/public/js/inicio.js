'use strict';

/**
 * Menu de entrada.
 *
 * Trabaja sin conexion a proposito: lo primero que hace es contar lo que quedo
 * pendiente de sincronizar en cada modulo, leyendo sus IndexedDB directo. Eso
 * no necesita red, y es justo lo que el inspector quiere ver al volver de la
 * playa. Los contadores del servidor se piden despues y, si no hay senal,
 * simplemente no se muestran.
 */
const $ = (s) => document.querySelector(s);

// ------------------------------------------------------------------- tema

function aplicarTema(claro) {
  const raiz = document.documentElement;
  if (claro) raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');
  $('#tema').setAttribute('aria-label', claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', claro ? '#f4f5f7' : '#0a0a0b');
  try { localStorage.setItem('yard-tema', claro ? 'claro' : 'oscuro'); } catch (e) { /* modo privado */ }
}
$('#tema').addEventListener('click', () =>
  aplicarTema(document.documentElement.getAttribute('data-tema') !== 'claro'));
aplicarTema(document.documentElement.getAttribute('data-tema') === 'claro');

// --------------------------------------------------------- cola pendiente

/**
 * Cuenta la cola de un modulo sin abrir su app.
 *
 * Ojo: se abre SIN numero de version. Con version explicita, si el modulo
 * todavia no se uso en este navegador, `open` crearia la base vacia y dispararia
 * un upgrade que despues choca con el del modulo. Sin version, si no existe se
 * crea vacia y devuelve 0, que es la respuesta correcta.
 */
function contarCola(nombreBase) {
  return new Promise((res) => {
    let req;
    try { req = indexedDB.open(nombreBase); } catch (e) { res(0); return; }
    req.onerror = () => res(0);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cola')) { db.close(); res(0); return; }
      try {
        const t = db.transaction('cola', 'readonly').objectStore('cola').count();
        t.onsuccess = () => { res(t.result || 0); db.close(); };
        t.onerror = () => { res(0); db.close(); };
      } catch (e) { res(0); db.close(); }
    };
  });
}

async function verCola() {
  const [patrullas, unidades] = await Promise.all([
    contarCola('yard'),
    contarCola('yard-unidades')
  ]);
  const total = patrullas + unidades;
  const el = $('#aviso-cola');
  if (!total) { el.hidden = true; return; }

  const partes = [];
  if (patrullas) partes.push(`${patrullas} de patrullas`);
  if (unidades) partes.push(`${unidades} de unidades`);

  $('#aviso-cola-txt').textContent =
    `${total} ${total === 1 ? 'carga pendiente' : 'cargas pendientes'} de sincronizar · ${partes.join(' y ')}`;
  el.href = unidades && !patrullas ? './unidades/' : './patrullas/';
  el.hidden = false;
}

// -------------------------------------------------------------- contadores

function iniciales(u) {
  if (!u) return '';
  const n = (u.nombre || '').trim();
  if (n) {
    const p = n.split(/\s+/).filter(Boolean);
    return (p.length > 1 ? p[0][0] + p[1][0] : p[0].slice(0, 2)).toUpperCase();
  }
  return (u.email || '').split('@')[0].slice(0, 2).toUpperCase();
}

async function verContadores() {
  try {
    const [cat, hoy, viajes] = await Promise.all([
      fetch('api/catalogos', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
      fetch('api/inspecciones/hoy', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)),
      fetch('api/unidades/viajes?estado=abierto', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null))
    ]);

    if (cat && cat.usuario) {
      $('#avatar').textContent = iniciales(cat.usuario);
      $('#avatar').title = cat.usuario.email;
      // Solo si hay un nombre de verdad. El pedazo del email antes del arroba
      // no es un nombre: "Hola, tpozo" se lee peor que "Hola" a secas.
      const nombre = (cat.usuario.nombre || '').trim();
      if (nombre) $('#nombre').textContent = ', ' + nombre.split(/\s+/)[0];
    }
    if (hoy) $('#c-patrullas').textContent = hoy.inspecciones.length;
    if (viajes) $('#c-unidades').textContent = viajes.viajes.length;

    if (!cat && !hoy && !viajes) throw new Error('sin respuesta');
    $('#estado-conexion').textContent = '';
  } catch (e) {
    // Los guiones quedan como estan: mejor que mostrar un cero que no es cierto.
    $('#estado-conexion').textContent =
      'Sin conexión. Podés entrar igual: lo que cargues se sincroniza después.';
  }
}

verCola();
verContadores();
window.addEventListener('online', () => { verCola(); verContadores(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
