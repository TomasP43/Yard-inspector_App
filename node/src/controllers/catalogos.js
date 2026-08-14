'use strict';

const crypto = require('crypto');
const {
  Responsable,
  TipoDesvio,
  DesvioCatalogo,
  Demora,
  Controlador,
  EstadoControl,
  Equipo
} = require('../database/models');

/**
 * Todos los catalogos en una sola respuesta.
 *
 * La PWA los guarda en IndexedDB porque el formulario tiene que poder armarse
 * sin conexion. Van juntos a proposito: si fueran 6 endpoints, el inspector
 * podria quedar con la mitad cacheada y un formulario a medio construir.
 *
 * El ETag permite que el cliente pregunte "cambio algo?" y reciba un 304 de
 * pocos bytes en vez del catalogo entero, que sobre 3G importa.
 */
async function todos(req, res, next) {
  try {
    const activo = { activo: true };

    const [responsables, tipos, desvios, demoras, controladores, estados, equipos] =
      await Promise.all([
        Responsable.findAll({ where: activo, order: [['orden', 'ASC'], ['nombre', 'ASC']] }),
        TipoDesvio.findAll({ where: activo, order: [['nombre', 'ASC']] }),
        DesvioCatalogo.findAll({
          where: activo,
          // Los mas usados primero: en el historico 5 desvios concentran el 70%
          // de los casos, asi el inspector no scrollea para lo habitual.
          order: [['usos_historicos', 'DESC'], ['nombre', 'ASC']]
        }),
        Demora.findAll({ where: activo, order: [['nombre', 'ASC']] }),
        Controlador.findAll({ where: activo, order: [['nombre', 'ASC']] }),
        EstadoControl.findAll({ where: activo, order: [['nombre', 'ASC']] }),
        Equipo.findAll({ where: activo, attributes: ['codigo'], order: [['codigo', 'ASC']] })
      ]);

    const payload = {
      responsables,
      tipos_desvio: tipos,
      desvios,
      demoras,
      controladores,
      estados_control: estados,
      // Solo los codigos: sirven para autocompletar, no hace falta el id.
      equipos: equipos.map((e) => e.codigo)
    };

    const etag = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    res.set('ETag', etag);
    res.json(payload);
  } catch (err) {
    next(err);
  }
}

module.exports = { todos };
