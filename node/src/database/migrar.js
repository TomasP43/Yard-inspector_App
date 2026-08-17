'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { sequelize } = require('./models');

/**
 * Aplica las migraciones pendientes al arrancar.
 *
 * Por que existe: las migraciones estaban montadas en
 * /docker-entrypoint-initdb.d, que MySQL corre **solo la primera vez que se
 * crea el volumen**. Con la base ya creada, cualquier migracion nueva no se
 * ejecutaba nunca y el codigo quedaba buscando tablas inexistentes. Con el
 * deploy automatico eso se rompe en silencio en cada push.
 *
 * Ahora este runner es el unico mecanismo: corre igual sobre una base vacia
 * que sobre una que ya tiene datos, y lleva registro de lo aplicado.
 */

/**
 * Donde estan los .sql. Se prueban candidatos en vez de una ruta fija porque
 * el arbol del contenedor NO es el del repo:
 *
 *   repo        node/src/database/migrar.js  ->  <raiz>/migrations   (3 niveles)
 *   contenedor  /app/src/database/migrar.js  ->  /app/migrations     (2 niveles)
 *
 * El Dockerfile copia `src` dentro de /app, asi que se pierde el nivel `node/`.
 * Fijar 3 niveles hacia arriba funcionaba corriendo desde el repo y en el
 * contenedor apuntaba a /migrations, que no existe: readdir tiraba ENOENT, esto
 * explotaba antes del listen y el contenedor quedaba en ciclo de reinicio,
 * devolviendo 502 en todo, incluido /health.
 */
const CANDIDATOS = [
  process.env.MIGRATIONS_DIR,
  path.join(__dirname, '..', '..', 'migrations'),
  path.join(__dirname, '..', '..', '..', 'migrations')
].filter(Boolean);

let DIR = null;

async function ubicarMigraciones() {
  if (DIR) return DIR;
  for (const c of CANDIDATOS) {
    try {
      const st = await fs.stat(c);
      if (st.isDirectory()) { DIR = c; return DIR; }
    } catch (e) { /* probar el siguiente */ }
  }
  throw new Error(
    'no se encontro la carpeta de migraciones. Probe: ' + CANDIDATOS.join(' | ') +
    '. Se monta con ./migrations:/app/migrations:ro, o se fija con MIGRATIONS_DIR.'
  );
}

async function asegurarTabla() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS migracion_aplicada (
      nombre VARCHAR(120) NOT NULL,
      checksum CHAR(64) NOT NULL,
      aplicada_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (nombre)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

/**
 * Parte un archivo .sql en sentencias.
 *
 * Tiene que entender `DELIMITER`, que no es SQL sino una instruccion del
 * cliente mysql: sin eso, el `;` de adentro de un trigger corta la sentencia
 * al medio y el CREATE TRIGGER falla.
 */
function separarSentencias(sql) {
  const sentencias = [];
  let delim = ';';
  let acumulado = [];

  const cerrar = () => {
    const texto = acumulado.join('\n').trim();
    acumulado = [];
    if (!texto) return;
    // descartar lo que quedo siendo solo comentarios
    if (!texto.replace(/^\s*--.*$/gm, '').trim()) return;
    sentencias.push(texto);
  };

  for (const linea of sql.split(/\r?\n/)) {
    const limpia = linea.trim();

    if (/^DELIMITER\s+/i.test(limpia)) {
      cerrar();
      delim = limpia.replace(/^DELIMITER\s+/i, '').trim();
      continue;
    }

    // El corte se decide sobre la linea sin su comentario final: sin esto,
    // algo como `foo INT, -- ver nota;` cortaria la sentencia al medio.
    // Se guarda la version sin comentario para no arrastrarlo a la sentencia.
    const sinComentario = limpia.replace(/--.*$/, '').trimEnd();

    if (sinComentario.endsWith(delim)) {
      acumulado.push(sinComentario.slice(0, sinComentario.length - delim.length));
      cerrar();
    } else {
      acumulado.push(linea);
    }
  }
  cerrar();

  return sentencias;
}

/**
 * Aplica un archivo entero sobre UNA SOLA conexion.
 *
 * No es un detalle: 003_datos_historicos.sql encadena
 *   INSERT INTO inspeccion ...;  SET @i = LAST_INSERT_ID();  INSERT ... VALUES (@i, ...)
 * y `@i` es una variable de sesion. Si cada sentencia saliera por una conexion
 * distinta del pool, `@i` llegaria NULL y se cargarian las 4.018 inspecciones
 * sin sus desvios ni sus fotos, sin que falle nada visible. Lo mismo vale para
 * el START TRANSACTION / COMMIT que el propio archivo trae.
 */
async function aplicar(nombre, sql) {
  const sentencias = separarSentencias(sql);
  console.log(`[migrar] ${nombre}: ${sentencias.length} sentencia(s)`);

  const conn = await sequelize.connectionManager.getConnection();

  // El objeto que devuelve el pool es la conexion cruda de mysql2, que es de
  // callbacks y expone .promise(). Se contempla que ya venga promisificada:
  // depender de una sola forma ata el runner a un detalle interno de Sequelize.
  const ejecutar = (sql) => (typeof conn.promise === 'function'
    ? conn.promise().query(sql)
    : new Promise((res, rej) => conn.query(sql, (e, r) => (e ? rej(e) : res(r)))));

  try {
    for (let i = 0; i < sentencias.length; i++) {
      try {
        await ejecutar(sentencias[i]);
      } catch (err) {
        // El DDL de MySQL no es transaccional: lo ya aplicado queda. Se corta
        // aca y se avisa con la sentencia exacta, porque seguir dejaria la base
        // a medio migrar sin que nadie se entere.
        const recorte = sentencias[i].slice(0, 200).replace(/\s+/g, ' ');
        throw new Error(
          `migracion ${nombre} fallo en la sentencia ${i + 1}/${sentencias.length}: ` +
          `${err.message}\n  -> ${recorte}...`
        );
      }
    }
  } finally {
    sequelize.connectionManager.releaseConnection(conn);
  }
}

/**
 * Toma como ya aplicadas las migraciones que corrieron con el mecanismo viejo.
 *
 * Las bases que ya existen tienen 001 a 004 cargadas por
 * /docker-entrypoint-initdb.d, pero ningun registro de eso. Sin este paso el
 * runner intentaria reaplicarlas y fallaria con "table already exists".
 *
 * Solo actua cuando la base tiene tablas Y el registro esta vacio, o sea una
 * unica vez y nada mas sobre instalaciones anteriores a este runner. En una
 * base nueva no hace nada y se aplica todo desde 001.
 */
const BASELINE = process.env.MIGRACION_BASELINE || '004_desvios_de_usuario.sql';

async function adoptarBaseline(archivos, dir) {
  const [[{ n }]] = await sequelize.query(`
    SELECT COUNT(*) AS n FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name <> 'migracion_aplicada'
  `);
  if (Number(n) === 0) return 0;

  const [[{ m }]] = await sequelize.query('SELECT COUNT(*) AS m FROM migracion_aplicada');
  if (Number(m) > 0) return 0;

  const previas = archivos.filter((f) => f <= BASELINE);
  for (const nombre of previas) {
    const sql = await fs.readFile(path.join(dir, nombre), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    await sequelize.query(
      'INSERT INTO migracion_aplicada (nombre, checksum) VALUES (?, ?)',
      { replacements: [nombre, checksum] }
    );
  }
  console.log(
    `[migrar] base existente adoptada: ${previas.length} migracion(es) hasta ${BASELINE} ` +
    'se marcan como aplicadas sin ejecutarse'
  );
  return previas.length;
}

async function migrar() {
  await asegurarTabla();

  // Un solo proceso migrando a la vez: si hay mas de una replica arrancando,
  // las demas esperan en vez de pisarse.
  const [[lock]] = await sequelize.query("SELECT GET_LOCK('yard_migrar', 60) AS ok");
  if (!lock || lock.ok !== 1) throw new Error('no se pudo tomar el lock de migracion');

  try {
    const dir = await ubicarMigraciones();
    console.log(`[migrar] carpeta de migraciones: ${dir}`);

    const archivos = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    await adoptarBaseline(archivos, dir);

    const [aplicadas] = await sequelize.query('SELECT nombre, checksum FROM migracion_aplicada');
    const yaEsta = new Map(aplicadas.map((r) => [r.nombre, r.checksum]));

    let nuevas = 0;
    for (const nombre of archivos) {
      const sql = await fs.readFile(path.join(dir, nombre), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');

      if (yaEsta.has(nombre)) {
        // Editar una migracion ya aplicada es un error: lo que corrio en la
        // base y lo que dice el archivo dejan de coincidir.
        if (yaEsta.get(nombre) !== checksum) {
          console.warn(`[migrar] AVISO: ${nombre} cambio despues de haberse aplicado`);
        }
        continue;
      }

      await aplicar(nombre, sql);
      await sequelize.query(
        'INSERT INTO migracion_aplicada (nombre, checksum) VALUES (?, ?)',
        { replacements: [nombre, checksum] }
      );
      nuevas++;
      console.log(`[migrar] aplicada ${nombre}`);
    }

    if (nuevas === 0) console.log('[migrar] sin migraciones pendientes');
    else console.log(`[migrar] ${nuevas} migracion(es) aplicada(s)`);
  } finally {
    await sequelize.query("SELECT RELEASE_LOCK('yard_migrar')");
  }
}

module.exports = { migrar, separarSentencias };
