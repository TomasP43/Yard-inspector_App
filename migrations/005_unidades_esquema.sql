-- ============================================================================
-- Modulo de inspeccion de unidades.
--
-- Segundo modulo de la app: convive con el de patrullas en la misma base y
-- reusa la tabla `usuario`. Se monta en /yard/unidades/ con el permiso
-- `yard/unidades` en ttfa.
--
-- El estandar Furlong codifica toda averia con TRES codigos:
--     AREA  -  TIPO DE DANO  -  GRAVEDAD      (ej: 37 - 04 - 03)
-- El AppSheet actual solo guarda los dos primeros: la gravedad no se registra
-- en ningun lado, asi que hoy no se puede emitir el codigo completo ni medir
-- si los danos crecen. Este esquema la incorpora.
--
-- El `cuadrante` NO es gravedad: es la ubicacion dentro de la pieza. Cada
-- pieza se subdivide en una grilla (9 para superficies grandes como puertas o
-- techo, 3 para pilares, rieles y zocalos). Por eso vive en inspeccion_dano
-- junto a la parte, y se valida contra parte.cantidad_cuadrantes.
-- ============================================================================

SET NAMES utf8mb4;

-- ---------------------------------------------------------------- idiomas

-- La app se usa en Argentina (es) y Brasil (pt), y el corporativo pide ingles.
CREATE TABLE idioma (
  codigo CHAR(2) NOT NULL,
  nombre VARCHAR(40) NOT NULL,
  orden SMALLINT NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Traducciones de cualquier catalogo, en una sola tabla.
--
-- La alternativa era una columna por idioma en cada catalogo (nombre_es,
-- nombre_pt, nombre_en). Se descarto: agregar un cuarto idioma obligaria a
-- un ALTER en cada tabla, y hay ocho catalogos traducibles. Asi, sumar un
-- idioma es insertar filas.
--
-- El `nombre` de cada catalogo queda como canonico en castellano (es lo que
-- viene de AppSheet) y ademas es el respaldo cuando falta la traduccion.
CREATE TABLE traduccion (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tabla VARCHAR(40) NOT NULL,
  fila_id INT UNSIGNED NOT NULL,
  campo VARCHAR(40) NOT NULL DEFAULT 'nombre',
  idioma CHAR(2) NOT NULL,
  texto VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_traduccion (tabla, fila_id, campo, idioma),
  KEY ix_traduccion_busqueda (tabla, idioma),
  CONSTRAINT fk_traduccion_idioma FOREIGN KEY (idioma) REFERENCES idioma (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------ ubicaciones

CREATE TABLE playa (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  pais VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_playa_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE destino (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  pais VARCHAR(40) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_destino_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------- flujos y etapas

CREATE TABLE flujo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  playa_origen_id INT UNSIGNED NOT NULL,
  destino_id INT UNSIGNED NULL,
  orden SMALLINT NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_flujo_nombre (nombre),
  KEY ix_flujo_playa (playa_origen_id),
  CONSTRAINT fk_flujo_playa FOREIGN KEY (playa_origen_id) REFERENCES playa (id),
  CONSTRAINT fk_flujo_destino FOREIGN KEY (destino_id) REFERENCES destino (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Las etapas son filas y no un ENUM: el administrador agrega, reordena y
-- desactiva sin migracion. Cada una define que exige al inspector.
CREATE TABLE etapa (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  flujo_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  orden SMALLINT NOT NULL,
  requiere_foto_panoramica TINYINT(1) NOT NULL DEFAULT 0,
  requiere_firma_inspector TINYINT(1) NOT NULL DEFAULT 1,
  requiere_foto_por_dano TINYINT(1) NOT NULL DEFAULT 1,
  permite_sin_danos TINYINT(1) NOT NULL DEFAULT 1,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_etapa_nombre (flujo_id, nombre),
  UNIQUE KEY uq_etapa_orden (flujo_id, orden),
  CONSTRAINT fk_etapa_flujo FOREIGN KEY (flujo_id) REFERENCES flujo (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------ catalogos del estandar

CREATE TABLE parte (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- numero del check list de Furlong (37 = Techo). Queda NULL hasta cargar la
  -- tabla oficial de codigos: el listado de partes vino sin ellos.
  codigo VARCHAR(4) NULL,
  nombre VARCHAR(120) NOT NULL,
  grupo ENUM('Exterior','Interior','Mecanica') NOT NULL DEFAULT 'Exterior',
  -- 9 = superficies grandes (puertas, techo, capot, paragolpes, guardabarros)
  -- 3 = pilares, rieles, zocalos, estribos
  -- 1 = piezas chicas donde el cuadrante no aplica
  cantidad_cuadrantes TINYINT UNSIGNED NOT NULL DEFAULT 1,
  orden SMALLINT NOT NULL DEFAULT 0,
  -- cuantas veces se uso en el historico: ordena la pantalla del inspector
  usos_historicos INT UNSIGNED NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_parte_nombre (nombre),
  KEY ix_parte_grupo (grupo, orden),
  CONSTRAINT ck_parte_cuadrantes CHECK (cantidad_cuadrantes IN (1, 3, 9, 12))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tipo_dano (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(4) NULL,
  nombre VARCHAR(120) NOT NULL,
  usos_historicos INT UNSIGNED NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  revisar TINYINT(1) NOT NULL DEFAULT 0,
  creado_por_usuario_id INT UNSIGNED NULL,
  creado_en TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  -- utf8mb4_0900_ai_ci ignora acentos y mayusculas: el UNIQUE ya frena
  -- 'Rayado'/'rayado' y 'Malformacion'/'Malformación' sin una linea de codigo
  UNIQUE KEY uq_tipo_dano_nombre (nombre),
  KEY ix_tipo_dano_revisar (revisar),
  CONSTRAINT fk_tipo_dano_creador FOREIGN KEY (creado_por_usuario_id)
    REFERENCES usuario (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- El tercer codigo del estandar, el que hoy no se registra.
CREATE TABLE gravedad (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo TINYINT UNSIGNED NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  desde_cm DECIMAL(5,1) NULL,
  hasta_cm DECIMAL(5,1) NULL,
  orden SMALLINT NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gravedad_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- El campo Comentario de AppSheet ya funcionaba como catalogo encubierto
-- ('Malformacion' 198, 'Malformación' 111, 'Malfromacion' 9). Se formaliza.
CREATE TABLE detalle_dano (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(160) NOT NULL,
  usos_historicos INT UNSIGNED NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  revisar TINYINT(1) NOT NULL DEFAULT 0,
  creado_por_usuario_id INT UNSIGNED NULL,
  creado_en TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_detalle_dano_nombre (nombre),
  KEY ix_detalle_dano_revisar (revisar),
  CONSTRAINT fk_detalle_dano_creador FOREIGN KEY (creado_por_usuario_id)
    REFERENCES usuario (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE modelo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(60) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_modelo_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------- viajes y unidades

-- De donde salieron los datos de un viaje. El sistema de solicitudes lo migra
-- otro equipo y el contrato todavia no esta definido, asi que la entrada se
-- aisla detras de adaptadores y aca queda registrado cual se uso.
CREATE TABLE importacion (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  playa_id INT UNSIGNED NOT NULL,
  adaptador VARCHAR(40) NOT NULL,
  archivo VARCHAR(255) NULL,
  -- el payload crudo permite reprocesar sin volver a pedir el archivo
  payload LONGTEXT NULL,
  estado ENUM('pendiente','ok','error') NOT NULL DEFAULT 'pendiente',
  error TEXT NULL,
  recibido_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_id INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_importacion_playa (playa_id, recibido_en),
  CONSTRAINT fk_importacion_playa FOREIGN KEY (playa_id) REFERENCES playa (id),
  CONSTRAINT fk_importacion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE viaje (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid CHAR(36) NOT NULL,
  playa_id INT UNSIGNED NOT NULL,
  flujo_id INT UNSIGNED NOT NULL,
  equipo_codigo INT UNSIGNED NULL,
  fecha DATE NOT NULL,
  -- id de la solicitud en el sistema de origen (SOL-000001), para poder
  -- reconciliar sin acoplarnos a su esquema
  referencia_externa VARCHAR(60) NULL,
  origen_datos VARCHAR(40) NOT NULL DEFAULT 'manual',
  importacion_id INT UNSIGNED NULL,
  estado ENUM('abierto','cerrado','anulado') NOT NULL DEFAULT 'abierto',
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_viaje_uuid (uuid),
  UNIQUE KEY uq_viaje_referencia (playa_id, referencia_externa),
  KEY ix_viaje_fecha (playa_id, fecha),
  KEY ix_viaje_flujo (flujo_id, fecha),
  CONSTRAINT fk_viaje_playa FOREIGN KEY (playa_id) REFERENCES playa (id),
  CONSTRAINT fk_viaje_flujo FOREIGN KEY (flujo_id) REFERENCES flujo (id),
  CONSTRAINT fk_viaje_importacion FOREIGN KEY (importacion_id) REFERENCES importacion (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE unidad (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  viaje_id INT UNSIGNED NOT NULL,
  vin VARCHAR(20) NOT NULL,
  modelo_id INT UNSIGNED NULL,
  katashiki VARCHAR(40) NULL,
  secuencia SMALLINT UNSIGNED NULL,
  orden_bajada SMALLINT UNSIGNED NULL,
  destino_id INT UNSIGNED NULL,
  so VARCHAR(40) NULL,
  linea_txt VARCHAR(255) NULL,
  PRIMARY KEY (id),
  -- vin indexado pero NO unico: un mismo vehiculo viaja mas de una vez
  KEY ix_unidad_vin (vin),
  UNIQUE KEY uq_unidad_viaje_vin (viaje_id, vin),
  CONSTRAINT fk_unidad_viaje FOREIGN KEY (viaje_id) REFERENCES viaje (id) ON DELETE CASCADE,
  CONSTRAINT fk_unidad_modelo FOREIGN KEY (modelo_id) REFERENCES modelo (id),
  CONSTRAINT fk_unidad_destino FOREIGN KEY (destino_id) REFERENCES destino (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------- inspeccion

CREATE TABLE inspeccion_unidad (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- generado en el dispositivo: clave de idempotencia de la cola offline
  uuid CHAR(36) NOT NULL,
  unidad_id INT UNSIGNED NOT NULL,
  etapa_id INT UNSIGNED NOT NULL,
  inspector_id INT UNSIGNED NOT NULL,
  registrado_en DATETIME NOT NULL,
  sincronizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resultado ENUM('OK','CON_DANOS') NOT NULL,
  foto_panoramica VARCHAR(255) NULL,
  foto_vin VARCHAR(255) NULL,
  firma_inspector VARCHAR(255) NULL,
  observacion TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inspeccion_unidad_uuid (uuid),
  -- una sola inspeccion por unidad y etapa
  UNIQUE KEY uq_inspeccion_unidad_etapa (unidad_id, etapa_id),
  KEY ix_inspeccion_unidad_fecha (registrado_en),
  KEY ix_inspeccion_unidad_inspector (inspector_id, registrado_en),
  CONSTRAINT fk_iu_unidad FOREIGN KEY (unidad_id) REFERENCES unidad (id) ON DELETE CASCADE,
  CONSTRAINT fk_iu_etapa FOREIGN KEY (etapa_id) REFERENCES etapa (id),
  CONSTRAINT fk_iu_inspector FOREIGN KEY (inspector_id) REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE inspeccion_dano (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  inspeccion_id INT UNSIGNED NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  parte_id INT UNSIGNED NOT NULL,
  -- ubicacion dentro de la pieza. 0 = sin excepcion / no aplica.
  -- El limite superior depende de parte.cantidad_cuadrantes y lo valida un
  -- trigger: un CHECK no puede consultar otra tabla.
  cuadrante TINYINT UNSIGNED NOT NULL DEFAULT 0,
  tipo_dano_id INT UNSIGNED NOT NULL,
  gravedad_id INT UNSIGNED NULL,
  detalle_id INT UNSIGNED NULL,
  comentario VARCHAR(255) NULL,
  foto VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY ix_dano_inspeccion (inspeccion_id, orden),
  KEY ix_dano_parte (parte_id),
  KEY ix_dano_tipo (tipo_dano_id),
  CONSTRAINT fk_dano_inspeccion FOREIGN KEY (inspeccion_id)
    REFERENCES inspeccion_unidad (id) ON DELETE CASCADE,
  CONSTRAINT fk_dano_parte FOREIGN KEY (parte_id) REFERENCES parte (id),
  CONSTRAINT fk_dano_tipo FOREIGN KEY (tipo_dano_id) REFERENCES tipo_dano (id),
  CONSTRAINT fk_dano_gravedad FOREIGN KEY (gravedad_id) REFERENCES gravedad (id),
  CONSTRAINT fk_dano_detalle FOREIGN KEY (detalle_id) REFERENCES detalle_dano (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------------ roles

CREATE TABLE rol (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(60) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rol_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE usuario_rol (
  usuario_id INT UNSIGNED NOT NULL,
  rol_id INT UNSIGNED NOT NULL,
  -- NULL = el rol aplica a todas las playas
  playa_id INT UNSIGNED NULL,
  PRIMARY KEY (usuario_id, rol_id),
  KEY ix_usuario_rol_playa (playa_id),
  CONSTRAINT fk_ur_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_rol FOREIGN KEY (rol_id) REFERENCES rol (id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_playa FOREIGN KEY (playa_id) REFERENCES playa (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------------- triggers
--
-- Dos reglas que un CHECK no puede expresar porque necesitan mirar otra tabla.

DELIMITER $$

-- 1) El cuadrante tiene que existir en esa pieza. En el historico de AppSheet
--    hay 148 filas con cuadrantes 7, 8 o 9 sobre piezas que solo tienen 3.
CREATE TRIGGER tr_dano_valida_cuadrante_ins
BEFORE INSERT ON inspeccion_dano
FOR EACH ROW
BEGIN
  DECLARE v_max TINYINT UNSIGNED;
  DECLARE v_ok ENUM('OK','CON_DANOS');

  SELECT cantidad_cuadrantes INTO v_max FROM parte WHERE id = NEW.parte_id;
  IF NEW.cuadrante > v_max THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cuadrante_fuera_de_rango_para_la_parte';
  END IF;

  -- 2) Una inspeccion marcada OK no puede tener danos colgando.
  SELECT resultado INTO v_ok FROM inspeccion_unidad WHERE id = NEW.inspeccion_id;
  IF v_ok = 'OK' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'inspeccion_ok_no_admite_danos';
  END IF;
END$$

CREATE TRIGGER tr_dano_valida_cuadrante_upd
BEFORE UPDATE ON inspeccion_dano
FOR EACH ROW
BEGIN
  DECLARE v_max TINYINT UNSIGNED;
  SELECT cantidad_cuadrantes INTO v_max FROM parte WHERE id = NEW.parte_id;
  IF NEW.cuadrante > v_max THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'cuadrante_fuera_de_rango_para_la_parte';
  END IF;
END$$

DELIMITER ;

-- ----------------------------------------------------------------- vistas

-- Avance de un viaje: cuantas unidades tienen inspeccion en cada etapa.
CREATE OR REPLACE VIEW v_avance_viaje AS
  SELECT v.id AS viaje_id, v.fecha, v.equipo_codigo, e.id AS etapa_id,
         e.nombre AS etapa, e.orden,
         COUNT(DISTINCT u.id) AS unidades,
         COUNT(DISTINCT i.unidad_id) AS inspeccionadas,
         SUM(CASE WHEN i.resultado = 'CON_DANOS' THEN 1 ELSE 0 END) AS con_danos
    FROM viaje v
    JOIN unidad u ON u.viaje_id = v.id
    JOIN etapa e ON e.flujo_id = v.flujo_id AND e.activo = 1
    LEFT JOIN inspeccion_unidad i ON i.unidad_id = u.id AND i.etapa_id = e.id
   GROUP BY v.id, v.fecha, v.equipo_codigo, e.id, e.nombre, e.orden;

-- Cola de catalogo agregado por inspectores, para que un supervisor lo valide.
CREATE OR REPLACE VIEW v_catalogo_a_revisar AS
  SELECT 'tipo_dano' AS catalogo, d.id, d.nombre, d.creado_en, u.email AS creado_por,
         (SELECT COUNT(*) FROM inspeccion_dano x WHERE x.tipo_dano_id = d.id) AS usos
    FROM tipo_dano d LEFT JOIN usuario u ON u.id = d.creado_por_usuario_id
   WHERE d.revisar = 1
  UNION ALL
  SELECT 'detalle_dano', d.id, d.nombre, d.creado_en, u.email,
         (SELECT COUNT(*) FROM inspeccion_dano x WHERE x.detalle_id = d.id)
    FROM detalle_dano d LEFT JOIN usuario u ON u.id = d.creado_por_usuario_id
   WHERE d.revisar = 1;
