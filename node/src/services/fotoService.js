'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const DIR = process.env.UPLOADS_DIR || '/app/uploads';
const MAX_LADO = Number(process.env.FOTO_MAX_LADO || 1600);
const CALIDAD = Number(process.env.FOTO_CALIDAD || 80);

// Tope duro por foto ya decodificada. El celular deberia mandarlas comprimidas
// (~300 KB); si llega algo de 15 MB es que fallo la compresion del cliente y no
// queremos que un inspector con mala senal bloquee la cola de todos.
const MAX_BYTES = 12 * 1024 * 1024;

/**
 * Acepta un data URL ("data:image/jpeg;base64,...") o base64 pelado.
 */
function decodificar(entrada) {
  if (typeof entrada !== 'string' || entrada.length === 0) return null;
  const base64 = entrada.startsWith('data:')
    ? entrada.slice(entrada.indexOf(',') + 1)
    : entrada;
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) return null;
  if (buf.length > MAX_BYTES) {
    const err = new Error('foto_demasiado_grande');
    err.status = 413;
    throw err;
  }
  return buf;
}

/**
 * Guarda una foto y devuelve { ruta, bytes }.
 *
 * Se reprocesa siempre con sharp aunque el cliente ya haya comprimido: es lo
 * que garantiza que lo que se guarda es realmente una imagen y no cualquier
 * cosa disfrazada de base64. `rotate()` sin argumentos aplica la orientacion
 * EXIF y la descarta; sin eso las fotos de celular se ven acostadas.
 */
async function guardar(entrada, { uuid, orden, formato = 'jpeg', maxLado = MAX_LADO }) {
  const buf = decodificar(entrada);
  if (!buf) return null;

  const ahora = new Date();
  const subdir = path.join(
    String(ahora.getFullYear()),
    String(ahora.getMonth() + 1).padStart(2, '0')
  );
  await fs.mkdir(path.join(DIR, subdir), { recursive: true });

  // El uuid viene del cliente: no lo usamos crudo como nombre de archivo.
  const sufijo = crypto.randomBytes(4).toString('hex');
  const ext = formato === 'png' ? 'png' : 'jpg';
  const nombre = `${uuid.replace(/[^a-zA-Z0-9-]/g, '')}-${orden}-${sufijo}.${ext}`;
  const relativa = path.posix.join(subdir.replace(/\\/g, '/'), nombre);

  let pipeline = sharp(buf)
    .rotate()
    .resize(maxLado, maxLado, { fit: 'inside', withoutEnlargement: true });

  // Las firmas van en PNG y no en JPEG: se dibujan sobre un canvas
  // transparente, y JPEG no tiene canal alfa — el trazo quedaria sobre un
  // fondo negro. Ademas son dos colores, asi que PNG pesa menos que JPEG aca.
  pipeline = formato === 'png'
    ? pipeline.png({ compressionLevel: 9, palette: true })
    : pipeline.jpeg({ quality: CALIDAD, mozjpeg: true });

  const salida = await pipeline.toBuffer();

  await fs.writeFile(path.join(DIR, relativa), salida);
  return { ruta: relativa, bytes: salida.length };
}

/**
 * Borra archivos ya escritos. Se usa cuando la transaccion de la inspeccion
 * falla despues de haber guardado fotos: si no, quedan huerfanas ocupando disco.
 */
async function borrar(rutas) {
  await Promise.all(
    rutas.map((r) => fs.unlink(path.join(DIR, r)).catch(() => {}))
  );
}

module.exports = { guardar, borrar };
