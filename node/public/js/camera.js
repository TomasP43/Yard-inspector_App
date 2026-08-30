'use strict';

/**
 * Captura y compresion de fotos en el dispositivo.
 *
 * Comprimir ACA y no en el servidor es lo que hace viable el offline: una foto
 * de camara de celular son 3-5 MB. Tres por inspeccion, con varias inspecciones
 * encoladas esperando senal, llenan la cuota de IndexedDB y despues tardan una
 * eternidad en subir por 3G desde la playa. Comprimida queda en ~200-400 KB.
 *
 * El servidor igual la reprocesa con sharp: no confiamos en que lo que llega
 * sea realmente una imagen.
 */
const Camara = (() => {
  const MAX_LADO = 1600;
  const CALIDAD = 0.8;

  /**
   * `imageOrientation: 'from-image'` aplica la orientacion EXIF al decodificar.
   * Sin eso las fotos sacadas con el celular de costado quedan acostadas: el
   * canvas ignora el EXIF y dibuja los pixeles crudos.
   */
  const comprimir = (file) => procesar(file).then((r) => r.blob);

  async function procesar(file) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      // Safari viejo no soporta las opciones: se cae al decodificado normal.
      bitmap = await createImageBitmap(file);
    }

    const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close && bitmap.close();

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', CALIDAD));
    return { blob, canvas };
  }

  /**
   * Lo mismo, mas una lectura de si la foto sirve como prueba.
   *
   * Va aparte de `comprimir` porque patrullas y bahias no la necesitan y no
   * tienen por que pagar el analisis: ahi la foto es un respaldo de lo que dice
   * el formulario. En precarga **la foto ES la prueba** --lo unico que sostiene
   * un reclamo-- y hoy su calidad depende del pulso del inspector.
   *
   * Se mide sobre el canvas que la compresion ya dibujo, asi que no hay un
   * decode de mas. Eso importa: el riesgo declarado de este paso es la friccion,
   * y la queja mas repetida de las reseñas del rubro es exactamente «sacar fotos
   * deberia ser rapido, sin tantos requisitos sin sentido».
   */
  async function comprimirConLectura(file) {
    const { blob, canvas } = await procesar(file);
    return { blob, calidad: medir(canvas) };
  }

  /**
   * Nitidez y luz de una imagen ya dibujada.
   *
   * **La nitidez sale del percentil 99 del laplaciano, no de su varianza**, y
   * ahi esta todo el asunto. La varianza es la receta de manual y en esta app
   * daria falsos rechazos todo el dia: el inspector fotografia **paneles
   * pintados y planos**, que son legitimamente de baja varianza aunque esten
   * perfectamente enfocados. Un rayon sobre una puerta lisa es casi toda la
   * foto plana y un solo borde nitido.
   *
   * El percentil alto pregunta otra cosa: «¿el borde MAS nitido de esta foto es
   * nitido?». Una foto movida no tiene ninguno, sea cual sea su contenido.
   *
   * Se trabaja sobre una copia de ~360 px porque el laplaciano sobre 1600 px son
   * 2,5 millones de pixeles y el gesto tiene que sentirse instantaneo.
   */
  function medir(origen) {
    const ANCHO = 360;
    const esc = Math.min(1, ANCHO / origen.width);
    const w = Math.max(8, Math.round(origen.width * esc));
    const h = Math.max(8, Math.round(origen.height * esc));

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(origen, 0, 0, w, h);

    let px;
    try { px = ctx.getImageData(0, 0, w, h).data; }
    catch (e) { return null; }   // canvas manchado: se sigue sin lectura

    // Escala de grises con los coeficientes de luminancia, no el promedio
    // simple: el ojo --y el sensor-- pesan mucho mas el verde.
    const gris = new Float32Array(w * h);
    let suma = 0;
    for (let i = 0, j = 0; j < gris.length; i += 4, j++) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      gris[j] = g;
      suma += g;
    }
    const luz = suma / gris.length;

    // Laplaciano 3x3 y un histograma, que sale mas barato que ordenar 97.000
    // valores para sacar un percentil.
    const hist = new Uint32Array(256);
    let cuenta = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        const lap = Math.abs(
          gris[k - w] + gris[k + w] + gris[k - 1] + gris[k + 1] - 4 * gris[k]
        );
        hist[Math.min(255, lap | 0)]++;
        cuenta++;
      }
    }
    const corte = cuenta * 0.99;
    let acum = 0, nitidez = 0;
    for (let i = 0; i < 256; i++) {
      acum += hist[i];
      if (acum >= corte) { nitidez = i; break; }
    }

    return { nitidez, luz: Math.round(luz), aviso: avisoDe(nitidez, luz) };
  }

  /**
   * Los umbrales.
   *
   * **Elegidos para que el falso rechazo sea raro, no para atajar todo.** El
   * aviso no bloquea: si molesta cuando no corresponde, el inspector deja de
   * mirarlo y el paso entero se vuelve decorativo. Mejor que avise poco y que
   * cuando avise tenga razon.
   */
  const NITIDEZ_MIN = 18;   // por debajo de esto ni el borde mas marcado corta
  const LUZ_MIN = 42;       // penumbra: se ve la silueta y no el daño
  const LUZ_MAX = 233;      // quemada por el flash o por el sol de frente

  function avisoDe(nitidez, luz) {
    if (luz < LUZ_MIN) return 'oscura';
    if (luz > LUZ_MAX) return 'quemada';
    if (nitidez < NITIDEZ_MIN) return 'borrosa';
    return null;
  }

  const TEXTO_AVISO = {
    oscura: 'Se ve muy oscura',
    quemada: 'Está quemada de luz',
    borrosa: 'Se ve movida'
  };

  /** Blob -> base64 pelado, para mandarlo en el JSON de sincronizacion. */
  function aBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  return { comprimir, comprimirConLectura, aBase64, TEXTO_AVISO };
})();
