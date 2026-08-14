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
  async function comprimir(file) {
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
    return blob;
  }

  /** Blob -> base64 pelado, para mandarlo en el JSON de sincronizacion. */
  function aBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  return { comprimir, aBase64 };
})();
