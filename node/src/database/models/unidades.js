'use strict';

/**
 * Modelos del modulo de inspeccion de unidades.
 *
 * Se define como factory y no como modulo suelto para no importar `index.js`
 * desde aca: `Usuario` vive alla y el require cruzado seria circular. index.js
 * llama a esta funcion pasandole lo que hace falta.
 *
 * El esquema lo manda migrations/005 y 006. Nada de sync().
 */
module.exports = function definirUnidades(sequelize, DataTypes, { Usuario }) {

  // -------------------------------------------------------------- idiomas

  const Idioma = sequelize.define('idioma', {
    codigo: { type: DataTypes.CHAR(2), primaryKey: true },
    nombre: { type: DataTypes.STRING(40), allowNull: false },
    orden: { type: DataTypes.SMALLINT, defaultValue: 0 },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  // Traducciones de cualquier catalogo. Una sola tabla para los ocho, asi
  // sumar un idioma es insertar filas y no un ALTER en cada uno.
  const Traduccion = sequelize.define('traduccion', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    tabla: { type: DataTypes.STRING(40), allowNull: false },
    fila_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    campo: { type: DataTypes.STRING(40), defaultValue: 'nombre' },
    idioma: { type: DataTypes.CHAR(2), allowNull: false },
    texto: { type: DataTypes.STRING(255), allowNull: false }
  });

  // ---------------------------------------------------------- ubicaciones

  const Playa = sequelize.define('playa', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    codigo: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    nombre: { type: DataTypes.STRING(80), allowNull: false },
    pais: { type: DataTypes.STRING(40), allowNull: false },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  const Destino = sequelize.define('destino', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    pais: { type: DataTypes.STRING(40) },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  // ------------------------------------------------------ flujos y etapas

  const Flujo = sequelize.define('flujo', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    playa_origen_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    destino_id: { type: DataTypes.INTEGER.UNSIGNED },
    orden: { type: DataTypes.SMALLINT, defaultValue: 0 },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  const Etapa = sequelize.define('etapa', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    flujo_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    // En que playa ocurre. NULL = la de origen del viaje. Existe porque un
    // viaje Sorocaba -> Zarate descarga en Zarate: sin esto, el inspector de
    // Zarate no veia el viaje porque para el sistema era de Sorocaba.
    playa_id: { type: DataTypes.INTEGER.UNSIGNED },
    nombre: { type: DataTypes.STRING(60), allowNull: false },
    orden: { type: DataTypes.SMALLINT, allowNull: false },
    // que le exige al inspector esta etapa. Es configurable por flujo.
    requiere_foto_panoramica: { type: DataTypes.BOOLEAN, defaultValue: false },
    requiere_firma_inspector: { type: DataTypes.BOOLEAN, defaultValue: true },
    requiere_foto_por_dano: { type: DataTypes.BOOLEAN, defaultValue: true },
    permite_sin_danos: { type: DataTypes.BOOLEAN, defaultValue: true },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  // --------------------------------------------------- catalogos de danos

  const Parte = sequelize.define('parte', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    codigo: { type: DataTypes.STRING(4) },
    nombre: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    grupo: { type: DataTypes.ENUM('Exterior', 'Interior', 'Mecanica'), defaultValue: 'Exterior' },
    // 9 = superficies grandes, 3 = pilares/rieles/zocalos, 1 = no aplica.
    // Decide que grilla dibuja la pantalla y valida el cuadrante cargado.
    cantidad_cuadrantes: { type: DataTypes.TINYINT.UNSIGNED, defaultValue: 1 },
    orden: { type: DataTypes.SMALLINT, defaultValue: 0 },
    usos_historicos: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  const TipoDano = sequelize.define('tipo_dano', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    codigo: { type: DataTypes.STRING(4) },
    nombre: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    usos_historicos: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true },
    revisar: { type: DataTypes.BOOLEAN, defaultValue: false },
    creado_por_usuario_id: { type: DataTypes.INTEGER.UNSIGNED },
    creado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  });

  const DetalleDano = sequelize.define('detalle_dano', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(160), allowNull: false, unique: true },
    usos_historicos: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true },
    revisar: { type: DataTypes.BOOLEAN, defaultValue: false },
    creado_por_usuario_id: { type: DataTypes.INTEGER.UNSIGNED },
    creado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  });

  const Modelo = sequelize.define('modelo', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    activo: { type: DataTypes.BOOLEAN, defaultValue: true }
  });

  // ---------------------------------------------------- viajes y unidades

  const Importacion = sequelize.define('importacion', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    playa_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    adaptador: { type: DataTypes.STRING(40), allowNull: false },
    archivo: { type: DataTypes.STRING(255) },
    payload: { type: DataTypes.TEXT('long') },
    estado: { type: DataTypes.ENUM('pendiente', 'ok', 'error'), defaultValue: 'pendiente' },
    error: { type: DataTypes.TEXT },
    recibido_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    usuario_id: { type: DataTypes.INTEGER.UNSIGNED }
  });

  const Viaje = sequelize.define('viaje', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    uuid: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    playa_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    flujo_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    equipo_codigo: { type: DataTypes.INTEGER.UNSIGNED },
    fecha: { type: DataTypes.DATEONLY, allowNull: false },
    // id de la solicitud en el sistema de origen: permite reconciliar sin
    // acoplarse a su esquema
    referencia_externa: { type: DataTypes.STRING(60) },
    origen_datos: { type: DataTypes.STRING(40), defaultValue: 'manual' },
    importacion_id: { type: DataTypes.INTEGER.UNSIGNED },
    estado: { type: DataTypes.ENUM('abierto', 'cerrado', 'anulado'), defaultValue: 'abierto' },
    creado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
  });

  const Unidad = sequelize.define('unidad', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    viaje_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    vin: { type: DataTypes.STRING(20), allowNull: false },
    modelo_id: { type: DataTypes.INTEGER.UNSIGNED },
    katashiki: { type: DataTypes.STRING(40) },
    secuencia: { type: DataTypes.SMALLINT.UNSIGNED },
    orden_bajada: { type: DataTypes.SMALLINT.UNSIGNED },
    destino_id: { type: DataTypes.INTEGER.UNSIGNED },
    so: { type: DataTypes.STRING(40) },
    linea_txt: { type: DataTypes.STRING(255) }
  });

  // ----------------------------------------------------------- inspeccion

  const InspeccionUnidad = sequelize.define('inspeccion_unidad', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    // generado en el dispositivo: clave de idempotencia de la cola offline
    uuid: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
    unidad_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    etapa_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    inspector_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    registrado_en: { type: DataTypes.DATE, allowNull: false },
    sincronizado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    resultado: { type: DataTypes.ENUM('OK', 'CON_DANOS'), allowNull: false },
    foto_panoramica: { type: DataTypes.STRING(255) },
    foto_vin: { type: DataTypes.STRING(255) },
    firma_inspector: { type: DataTypes.STRING(255) },
    observacion: { type: DataTypes.TEXT }
  });

  const InspeccionDano = sequelize.define('inspeccion_dano', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    inspeccion_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    orden: { type: DataTypes.SMALLINT.UNSIGNED, defaultValue: 1 },
    parte_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    // ubicacion dentro de la pieza, no gravedad. 0 = no aplica.
    // El tope lo valida un trigger contra parte.cantidad_cuadrantes.
    cuadrante: { type: DataTypes.TINYINT.UNSIGNED, defaultValue: 0 },
    tipo_dano_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    detalle_id: { type: DataTypes.INTEGER.UNSIGNED },
    comentario: { type: DataTypes.STRING(255) },
    foto: { type: DataTypes.STRING(255) }
  });

  // ---------------------------------------------------------------- roles

  const Rol = sequelize.define('rol', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    codigo: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    nombre: { type: DataTypes.STRING(60), allowNull: false }
  });

  const UsuarioRol = sequelize.define('usuario_rol', {
    usuario_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    rol_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
    // NULL = el rol aplica a todas las playas
    playa_id: { type: DataTypes.INTEGER.UNSIGNED }
  });

  // ----------------------------------------------------------- relaciones

  Flujo.belongsTo(Playa, { as: 'playaOrigen', foreignKey: 'playa_origen_id' });
  Flujo.belongsTo(Destino, { as: 'destino', foreignKey: 'destino_id' });
  Flujo.hasMany(Etapa, { as: 'etapas', foreignKey: 'flujo_id' });
  Etapa.belongsTo(Flujo, { as: 'flujo', foreignKey: 'flujo_id' });
  Etapa.belongsTo(Playa, { as: 'playa', foreignKey: 'playa_id' });

  Viaje.belongsTo(Playa, { as: 'playa', foreignKey: 'playa_id' });
  Viaje.belongsTo(Flujo, { as: 'flujo', foreignKey: 'flujo_id' });
  Viaje.belongsTo(Importacion, { as: 'importacion', foreignKey: 'importacion_id' });
  Viaje.hasMany(Unidad, { as: 'unidades', foreignKey: 'viaje_id' });

  Unidad.belongsTo(Viaje, { as: 'viaje', foreignKey: 'viaje_id' });
  Unidad.belongsTo(Modelo, { as: 'modelo', foreignKey: 'modelo_id' });
  Unidad.belongsTo(Destino, { as: 'destino', foreignKey: 'destino_id' });
  Unidad.hasMany(InspeccionUnidad, { as: 'inspecciones', foreignKey: 'unidad_id' });

  InspeccionUnidad.belongsTo(Unidad, { as: 'unidad', foreignKey: 'unidad_id' });
  InspeccionUnidad.belongsTo(Etapa, { as: 'etapa', foreignKey: 'etapa_id' });
  InspeccionUnidad.belongsTo(Usuario, { as: 'inspector', foreignKey: 'inspector_id' });
  InspeccionUnidad.hasMany(InspeccionDano, { as: 'danos', foreignKey: 'inspeccion_id' });

  InspeccionDano.belongsTo(InspeccionUnidad, { as: 'inspeccion', foreignKey: 'inspeccion_id' });
  InspeccionDano.belongsTo(Parte, { as: 'parte', foreignKey: 'parte_id' });
  InspeccionDano.belongsTo(TipoDano, { as: 'tipo', foreignKey: 'tipo_dano_id' });
  InspeccionDano.belongsTo(DetalleDano, { as: 'detalle', foreignKey: 'detalle_id' });

  Importacion.belongsTo(Playa, { as: 'playa', foreignKey: 'playa_id' });
  Importacion.belongsTo(Usuario, { as: 'usuario', foreignKey: 'usuario_id' });

  Usuario.belongsToMany(Rol, { as: 'roles', through: UsuarioRol, foreignKey: 'usuario_id', otherKey: 'rol_id' });
  Rol.belongsToMany(Usuario, { as: 'usuarios', through: UsuarioRol, foreignKey: 'rol_id', otherKey: 'usuario_id' });
  UsuarioRol.belongsTo(Playa, { as: 'playa', foreignKey: 'playa_id' });

  Traduccion.belongsTo(Idioma, { as: 'idiomaRef', foreignKey: 'idioma', targetKey: 'codigo' });

  return {
    Idioma, Traduccion,
    Playa, Destino, Flujo, Etapa,
    Parte, TipoDano, DetalleDano, Modelo,
    Importacion, Viaje, Unidad,
    InspeccionUnidad, InspeccionDano,
    Rol, UsuarioRol
  };
};
