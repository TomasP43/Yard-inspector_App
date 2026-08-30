'use strict';

/**
 * Lector de codigos con la camara, dentro de la app.
 *
 * Usa `BarcodeDetector`, que Chrome en Android trae nativo. **No hay libreria
 * empaquetada a proposito**: los inspectores usan Android, y meter un lector JS
 * en el shell son ~50 KB que hay que cachear para offline y una dependencia mas
 * que mantener. Si algun dia entra un iPhone, `soportado()` devuelve false y ahi
 * si habra que decidir que se hace -- pero que se sepa, no que falle raro.
 *
 * Por que el escaneo va ACA y no en la camara del telefono: el QR de la bahia
 * lleva **solo el token**, no una URL. Escanearlo por fuera de la app no lleva a
 * ningun lado, asi que la unica puerta para cargar un control es esta.
 *
 * Lee dos familias de codigo y por eso el formato es un parametro:
 *
 * | Modulo | Formatos | De donde sale el codigo |
 * |---|---|---|
 * | Bahias | `qr_code` | Un cartel que imprimimos nosotros |
 * | Precarga | `code_128`, `code_39`, `data_matrix` | La etiqueta de VIN que el auto trae de fabrica |
 *
 * El default sigue siendo QR para que sumar precarga no toque a bahias. Y el
 * chequeo de formato va aparte de `soportado()`: un navegador puede traer
 * `BarcodeDetector` con QR y sin Code 128, asi que preguntar solo si existe el
 * lector diria que si y despues no leeria nada.
 *
 * La camara se apaga siempre al salir. Un `getUserMedia` sin `stop()` deja la
 * luz prendida y el telefono caliente en el bolsillo del inspector.
 */
const Escaner = (() => {

  let stream = null;
  let corriendo = false;
  let timer = null;

  /** Los codigos de las bahias. Es el default para no tocar a quien ya llamaba. */
  const FORMATOS_QR = ['qr_code'];

  const soportado = () => 'BarcodeDetector' in window
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /**
   * Si el navegador sabe leer TODOS estos formatos.
   *
   * Es asincrona porque `getSupportedFormats()` lo es, y por eso no se pudo
   * meter dentro de `soportado()`, que bahias usa como funcion comun. Quien la
   * llama la consulta una vez y pinta el aviso; nunca abre la camara para
   * descubrir ahi que no puede leer.
   */
  async function soportaFormatos(lista) {
    if (!soportado()) return false;
    try {
      const hay = await BarcodeDetector.getSupportedFormats();
      return (lista || FORMATOS_QR).every((f) => hay.includes(f));
    } catch (e) {
      return false;   // si ni siquiera se puede preguntar, no se promete que si
    }
  }

  /**
   * Abre la camara y resuelve cuando lee un codigo que `validar` acepta.
   *
   * `formatos` es opcional y por defecto lee QR, que es lo que pide bahias.
   *
   * `validar(texto)` devuelve `true` para aceptar, o un **texto de error** para
   * rechazarlo y seguir leyendo. Eso es lo que hace que escanear el QR de la
   * bahia de al lado avise y deje reintentar, en vez de cerrar el visor y
   * obligar a empezar de nuevo -- que con guantes y a contraluz pasa seguido.
   *
   * Rechaza con un motivo legible: 'sin_soporte', 'sin_permiso', 'sin_camara',
   * 'cancelado'. El que llama decide que decirle al inspector -- aca no se
   * inventan mensajes de pantalla.
   */
  function abrir(titulo, validar, formatos) {
    if (!soportado()) return Promise.reject(new Error('sin_soporte'));

    const caja = $('#escaner');
    const video = $('#escaner-video');
    $('#escaner-titulo').textContent = titulo || 'Escaneá el código';
    $('#escaner-error').hidden = true;
    caja.hidden = false;
    corriendo = true;

    return new Promise((resolver, rechazar) => {
      const terminar = (fn, arg) => { cerrar(); fn(arg); };

      // Cancelar es parte del contrato: si el inspector se arrepiente, la
      // camara tiene que apagarse igual.
      $('#escaner-cerrar').onclick = () => terminar(rechazar, new Error('cancelado'));

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      }).then((s) => {
        if (!corriendo) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        return video.play();
      }).then(() => {
        if (!corriendo) return;
        const detector = new BarcodeDetector({ formats: formatos || FORMATOS_QR });

        // Un intento cada 250 ms y no en cada cuadro: `detect()` es caro y a
        // 60 fps calienta el telefono sin leer mas rapido.
        let ultimo = null;
        timer = setInterval(() => {
          if (!corriendo || video.readyState < 2) return;
          detector.detect(video)
            .then((codigos) => {
              if (!corriendo || !codigos.length) return;
              const texto = (codigos[0].rawValue || '').trim();

              const veredicto = validar ? validar(texto) : true;
              if (veredicto === true) { terminar(resolver, texto); return; }

              // Mismo codigo rechazado cuatro veces por segundo: se avisa una
              // vez y no se parpadea el mensaje mientras lo tiene enfocado.
              if (texto !== ultimo) { ultimo = texto; avisar(veredicto); }
            })
            .catch(() => { /* un cuadro ilegible no es un error, es el proximo */ });
        }, 250);
      }).catch((e) => {
        const n = e && e.name;
        const motivo = n === 'NotAllowedError' || n === 'SecurityError' ? 'sin_permiso'
          : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'sin_camara'
          : 'sin_camara';
        terminar(rechazar, new Error(motivo));
      });
    });
  }

  function cerrar() {
    corriendo = false;
    clearInterval(timer);
    timer = null;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    const video = $('#escaner-video');
    if (video) video.srcObject = null;
    const caja = $('#escaner');
    if (caja) caja.hidden = true;
  }

  /** Aviso dentro del visor, sin cerrarlo: leer otro QR es seguir intentando. */
  function avisar(msg) {
    const el = $('#escaner-error');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  return { soportado, soportaFormatos, abrir, cerrar, avisar, FORMATOS_QR };
})();
