'use strict';

const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'yard',
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'db_yard',
    port: Number(process.env.DB_PORT || 3306),
    dialect: 'mysql',
    logging: false,
    timezone: '-03:00',
    define: {
      // El esquema lo manda migrations/001_initial.sql, no Sequelize.
      // Nada de sync(): los nombres son en castellano y no siguen las
      // convenciones que Sequelize generaria sola.
      timestamps: false,
      freezeTableName: true
    }
  }
);

// ------------------------------------------------------------------ catalogos

const Usuario = sequelize.define('usuario', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING(190), allowNull: false, unique: true },
  nombre: { type: DataTypes.STRING(120) },
  rol: { type: DataTypes.ENUM('inspector', 'supervisor', 'admin'), defaultValue: 'inspector' },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true },
  creado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

const Equipo = sequelize.define('equipo', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  codigo: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Responsable = sequelize.define('responsable', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true },
  orden: { type: DataTypes.SMALLINT, defaultValue: 0 }
});

const TipoDesvio = sequelize.define('tipo_desvio', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const DesvioCatalogo = sequelize.define('desvio_catalogo', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(160), allowNull: false, unique: true },
  tipo_desvio_id: { type: DataTypes.INTEGER.UNSIGNED },
  requiere_detalle: { type: DataTypes.BOOLEAN, defaultValue: false },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true },
  usos_historicos: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
  creado_por_usuario_id: { type: DataTypes.INTEGER.UNSIGNED },
  creado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  // 1 = lo agrego un inspector desde la app y nadie lo valido todavia
  revisar: { type: DataTypes.BOOLEAN, defaultValue: false }
});

const Demora = sequelize.define('demora', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(40), allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Controlador = sequelize.define('controlador', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(80), allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const EstadoControl = sequelize.define('estado_control', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  nombre: { type: DataTypes.STRING(60), allowNull: false, unique: true },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// -------------------------------------------------------------- transaccional

const Inspeccion = sequelize.define('inspeccion', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  uuid: { type: DataTypes.CHAR(36), allowNull: false, unique: true },
  // 'appsheet' = viene de la migracion del historico. Permite distinguirlas y
  // poder deshacer la migracion sin tocar lo que se cargo desde la app.
  origen: { type: DataTypes.ENUM('app', 'appsheet'), defaultValue: 'app' },
  registrado_en: { type: DataTypes.DATE, allowNull: false },
  // defaultValue explicito: la tabla tiene DEFAULT CURRENT_TIMESTAMP, pero si
  // el modelo declara la columna sin default Sequelize puede mandarla NULL en
  // el INSERT y pisar el default, violando el NOT NULL.
  sincronizado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  auditor_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  responsable_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  equipo_id: { type: DataTypes.INTEGER.UNSIGNED },
  resultado: { type: DataTypes.ENUM('OK', 'NG'), allowNull: false },
  tipo_desvio_id: { type: DataTypes.INTEGER.UNSIGNED },
  demora_id: { type: DataTypes.INTEGER.UNSIGNED },
  detalle: { type: DataTypes.TEXT },
  controlador_id: { type: DataTypes.INTEGER.UNSIGNED },
  estado_control_id: { type: DataTypes.INTEGER.UNSIGNED },
  foto_checklist: { type: DataTypes.STRING(255) },
  // Donde estaba en Drive. Con foto_checklist en NULL significa que el archivo
  // todavia no se copio al servidor.
  foto_checklist_origen: { type: DataTypes.STRING(255) }
});

const InspeccionDesvio = sequelize.define('inspeccion_desvio', {
  inspeccion_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true },
  desvio_id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true }
});

const InspeccionFoto = sequelize.define('inspeccion_foto', {
  id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
  inspeccion_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  orden: { type: DataTypes.TINYINT.UNSIGNED, defaultValue: 1 },
  // ruta NULL + ruta_origen con valor = la foto existe en Drive pero todavia
  // no se copio. El frontend lo usa para mostrar el hueco en vez de un roto.
  ruta: { type: DataTypes.STRING(255) },
  ruta_origen: { type: DataTypes.STRING(255) },
  orientacion: { type: DataTypes.ENUM('horizontal', 'vertical', 'libre'), defaultValue: 'libre' },
  bytes: { type: DataTypes.INTEGER.UNSIGNED },
  creado_en: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// ------------------------------------------------------------------ relaciones

Inspeccion.belongsTo(Usuario, { as: 'auditor', foreignKey: 'auditor_id' });
Inspeccion.belongsTo(Responsable, { as: 'responsable', foreignKey: 'responsable_id' });
Inspeccion.belongsTo(Equipo, { as: 'equipo', foreignKey: 'equipo_id' });
Inspeccion.belongsTo(TipoDesvio, { as: 'tipo', foreignKey: 'tipo_desvio_id' });
Inspeccion.belongsTo(Demora, { as: 'demora', foreignKey: 'demora_id' });
Inspeccion.belongsTo(Controlador, { as: 'controlador', foreignKey: 'controlador_id' });
Inspeccion.belongsTo(EstadoControl, { as: 'estadoControl', foreignKey: 'estado_control_id' });

Inspeccion.hasMany(InspeccionFoto, { as: 'fotos', foreignKey: 'inspeccion_id' });
InspeccionFoto.belongsTo(Inspeccion, { foreignKey: 'inspeccion_id' });

Inspeccion.belongsToMany(DesvioCatalogo, {
  as: 'desvios',
  through: InspeccionDesvio,
  foreignKey: 'inspeccion_id',
  otherKey: 'desvio_id'
});
DesvioCatalogo.belongsToMany(Inspeccion, {
  as: 'inspecciones',
  through: InspeccionDesvio,
  foreignKey: 'desvio_id',
  otherKey: 'inspeccion_id'
});
DesvioCatalogo.belongsTo(TipoDesvio, { as: 'tipo', foreignKey: 'tipo_desvio_id' });

module.exports = {
  sequelize,
  Sequelize,
  Usuario,
  Equipo,
  Responsable,
  TipoDesvio,
  DesvioCatalogo,
  Demora,
  Controlador,
  EstadoControl,
  Inspeccion,
  InspeccionDesvio,
  InspeccionFoto
};
