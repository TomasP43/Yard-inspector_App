-- ============================================================================
-- Yard Inspector - esquema inicial
--
-- Reemplaza la tabla plana de AppSheet (Form Responses 1, 13 columnas) por un
-- modelo normalizado. Decisiones que vienen del analisis del historico
-- (4.018 filas utiles, feb-2025 a ago-2026):
--
--   * La PK de AppSheet era Timestamp -> dos inspectores que guardan en el
--     mismo segundo colisionan. Aca va id propio + uuid de cliente.
--   * "Desvio" era EnumList (multivalor separado por coma) -> tabla puente.
--   * "Fotografias del desvio 2" NO era una foto del desvio: era el Checklist
--     Batea (Vertical), presente en el 100% de los OK. Va en su propia columna.
--   * El tipo de desvio lo cargaban inconsistente (53 de 77 desvios tenian mas
--     de un tipo asignado) -> el catalogo lleva un tipo por defecto, pero se
--     sigue guardando por inspeccion porque es editable.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '-03:00';

-- ---------------------------------------------------------------- catalogos

CREATE TABLE usuario (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email     VARCHAR(190) NOT NULL,
  nombre    VARCHAR(120) NULL,
  rol       ENUM('inspector','supervisor','admin') NOT NULL DEFAULT 'inspector',
  activo    TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuario_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- El codigo de equipo era Number en AppSheet. El "0236" que se ve en la lista
-- es formato de display (4 digitos con ceros a la izquierda), no el dato.
CREATE TABLE equipo (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo INT UNSIGNED NOT NULL,
  activo TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_equipo_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE responsable (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1,
  orden  SMALLINT    NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_responsable_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tipo_desvio (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tipo_desvio_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE desvio_catalogo (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre              VARCHAR(160) NOT NULL,
  -- tipo sugerido: el dominante en el historico. Solo prellena el formulario.
  tipo_desvio_id      INT UNSIGNED NULL,
  -- si es 1, el formulario exige cargar `detalle` (caso "Otro")
  requiere_detalle    TINYINT(1)   NOT NULL DEFAULT 0,
  activo              TINYINT(1)   NOT NULL DEFAULT 1,
  usos_historicos     INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_desvio_nombre (nombre),
  KEY ix_desvio_tipo (tipo_desvio_id),
  CONSTRAINT fk_desvio_tipo FOREIGN KEY (tipo_desvio_id)
    REFERENCES tipo_desvio (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE demora (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(40) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_demora_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE controlador (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_controlador_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- En AppSheet metian en el campo Controlador valores que no son personas
-- ("Solicitado controlar en TASA", "Controlado", "Sin firma del controlador").
-- Eso es un estado del control, no un controlador.
CREATE TABLE estado_control (
  id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(60) NOT NULL,
  activo TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_estado_control_nombre (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ------------------------------------------------------------- transaccional

CREATE TABLE inspeccion (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Clave de idempotencia generada en el celular ANTES de sincronizar.
  -- Es lo que hace que reintentar la cola offline no duplique registros.
  uuid              CHAR(36)     NOT NULL,

  -- Momento en que el inspector cargo la observacion (reloj del dispositivo,
  -- puede ser muy anterior al alta si venia offline).
  registrado_en     DATETIME     NOT NULL,
  -- Momento en que el servidor la recibio.
  sincronizado_en   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  auditor_id        INT UNSIGNED NOT NULL,
  responsable_id    INT UNSIGNED NOT NULL,
  equipo_id         INT UNSIGNED NULL,
  resultado         ENUM('OK','NG') NOT NULL,

  -- Solo aplican cuando resultado = 'NG'
  tipo_desvio_id    INT UNSIGNED NULL,
  demora_id         INT UNSIGNED NULL,
  detalle           TEXT         NULL,

  controlador_id    INT UNSIGNED NULL,
  estado_control_id INT UNSIGNED NULL,

  -- Checklist Batea (Vertical): se pide siempre, en OK y en NG.
  foto_checklist    VARCHAR(255) NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uq_inspeccion_uuid (uuid),

  -- "Patrulla del dia": WHERE registrado_en >= hoy AND resultado='NG'
  KEY ix_inspeccion_fecha_resultado (registrado_en, resultado),
  -- "Buscar por camion": todo el historico de un equipo, mas reciente primero
  KEY ix_inspeccion_equipo_fecha (equipo_id, registrado_en),
  KEY ix_inspeccion_auditor (auditor_id),
  KEY ix_inspeccion_responsable (responsable_id),

  CONSTRAINT fk_insp_auditor       FOREIGN KEY (auditor_id)        REFERENCES usuario (id),
  CONSTRAINT fk_insp_responsable   FOREIGN KEY (responsable_id)    REFERENCES responsable (id),
  CONSTRAINT fk_insp_equipo        FOREIGN KEY (equipo_id)         REFERENCES equipo (id),
  CONSTRAINT fk_insp_tipo          FOREIGN KEY (tipo_desvio_id)    REFERENCES tipo_desvio (id),
  CONSTRAINT fk_insp_demora        FOREIGN KEY (demora_id)         REFERENCES demora (id),
  CONSTRAINT fk_insp_controlador   FOREIGN KEY (controlador_id)    REFERENCES controlador (id),
  CONSTRAINT fk_insp_estado        FOREIGN KEY (estado_control_id) REFERENCES estado_control (id),

  -- Un NG sin tipo de desvio no tiene sentido; un OK no deberia traerlo.
  CONSTRAINT ck_insp_ng_tipo CHECK (
    (resultado = 'NG' AND tipo_desvio_id IS NOT NULL) OR
    (resultado = 'OK' AND tipo_desvio_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Reemplaza el EnumList separado por coma. 278 filas del historico traen mas
-- de un desvio en la misma inspeccion.
CREATE TABLE inspeccion_desvio (
  inspeccion_id INT UNSIGNED NOT NULL,
  desvio_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (inspeccion_id, desvio_id),
  KEY ix_id_desvio (desvio_id),
  CONSTRAINT fk_idesv_inspeccion FOREIGN KEY (inspeccion_id)
    REFERENCES inspeccion (id) ON DELETE CASCADE,
  CONSTRAINT fk_idesv_desvio FOREIGN KEY (desvio_id)
    REFERENCES desvio_catalogo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Reemplaza las 3 columnas fijas de foto por una relacion 1:N.
CREATE TABLE inspeccion_foto (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  inspeccion_id INT UNSIGNED NOT NULL,
  orden         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  ruta          VARCHAR(255) NOT NULL,
  -- 'horizontal' era obligatoria en NG; el resto eran opcionales.
  orientacion   ENUM('horizontal','vertical','libre') NOT NULL DEFAULT 'libre',
  bytes         INT UNSIGNED NULL,
  creado_en     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_foto_inspeccion (inspeccion_id, orden),
  CONSTRAINT fk_foto_inspeccion FOREIGN KEY (inspeccion_id)
    REFERENCES inspeccion (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ============================================================================
-- SEEDS
-- Los conteos que van en los comentarios y en usos_historicos salen del
-- historico real de AppSheet.
-- ============================================================================

INSERT INTO tipo_desvio (nombre) VALUES
  ('5s'), ('Mantenimiento'), ('Seguridad'), ('Calidad');

SET @t_5s            = (SELECT id FROM tipo_desvio WHERE nombre = '5s');
SET @t_Mantenimiento = (SELECT id FROM tipo_desvio WHERE nombre = 'Mantenimiento');
SET @t_Seguridad     = (SELECT id FROM tipo_desvio WHERE nombre = 'Seguridad');
SET @t_Calidad       = (SELECT id FROM tipo_desvio WHERE nombre = 'Calidad');

INSERT INTO responsable (nombre, orden) VALUES
  ('Trafico Brasil', 1),        -- 2587
  ('Trafico Autoport', 2),      --  597
  ('Trafico Chile', 3),         --  346
  ('Trafico Paraguay', 4),      --  188
  ('Trafico Bolivia', 5),       --   87
  ('Trafico CAT', 6),           --   76
  ('Trafico Puerto / Cruce', 7),--   47
  ('Trafico Uruguay', 8),       --   34
  ('Trafico Green Mile', 9),    --   20
  ('TTFA', 10),                 --   28
  ('Playa', 11);                --    8

INSERT INTO demora (nombre) VALUES
  ('Cargo'),            -- 2846
  ('Se retira'),        --  296
  ('Demora en carga');  --   91

-- Solo personas reales. 'Codero' y 'Fernandez' sin tilde eran la misma persona
-- que 'Cordero' y 'Fernandez' -> se fusionan en la migracion de datos.
INSERT INTO controlador (nombre) VALUES
  ('Feria'),        -- 501
  ('Cordero'),      -- 410 + 241 de 'Codero'
  ('Nores'),        -- 464
  ('Fernandez'),    -- 338 + 15 de 'Fernandez' con tilde
  ('Zecca'),        -- 245
  ('Barrientos'),   --  59
  ('Velarde');      --   1

INSERT INTO estado_control (nombre) VALUES
  ('Solicitado controlar en TASA'),  -- 29
  ('Controlado'),                    --  3
  ('Sin firma del controlador');     --  1

-- Catalogo de desvios: 78 valores crudos -> 71 conceptos.
-- El nombre canonico es la grafia mas frecuente del propio dato.
-- El tipo es el dominante del historico y solo prellena el formulario.
INSERT INTO desvio_catalogo (nombre, tipo_desvio_id, usos_historicos) VALUES
  ('Óxido en batea', @t_5s, 1183),
  ('Suciedad en batea', @t_5s, 487),
  ('Óxido avanzado en batea', @t_Mantenimiento, 337),
  ('Lona en mal estado', @t_Mantenimiento, 242),
  ('Óxido y suciedad en batea', @t_5s, 239),
  ('Fisura en parabrisa', @t_Seguridad, 146),
  ('Suciedad avanzada en batea', @t_5s, 77),
  ('Otro', @t_Calidad, 71),
  ('Parabrisa polarizado / acrílico', @t_Seguridad, 61),
  ('Perno faltante en cartel / brazo', @t_Seguridad, 60),
  ('Cubierta / rueda en mal estado', @t_Mantenimiento, 38),
  ('Rueda de auxilio en mal estado', @t_Seguridad, 38),
  ('Sunchos sin acomodar', @t_Calidad, 35),
  ('Patente en mal estado / ilegible', @t_Calidad, 32),
  ('Matafuego sin anillo de seguridad', @t_Seguridad, 28),
  ('Rampa desoldada / caída', @t_Seguridad, 28),
  ('Derrame en tanque', @t_Seguridad, 27),
  ('Caño de batea desoldado', @t_Mantenimiento, 26),
  ('Rampines trabados / sin orificios', @t_Calidad, 25),
  ('Piso desoldado / roto', @t_Mantenimiento, 24),
  ('Pérdida de aceite hidráulico', @t_Calidad, 21),
  ('Línea de vida cortada / rota', @t_Seguridad, 21),
  ('Cartel / brazo de cartel dañado', @t_Mantenimiento, 19),
  ('Pintura desgastada', @t_Calidad, 18),
  ('Motor / bomba hidráulica sin funcionar', @t_Mantenimiento, 17),
  ('Estribo roto / faltante', @t_Seguridad, 16),
  ('Garrafa de gas en batea', @t_Seguridad, 15),
  ('Guitarra desoldada / quebrada / fisurada', @t_Mantenimiento, 15),
  ('Matafuego vencido', @t_Seguridad, 15),
  ('Objetos / zunchos sueltos en batea', @t_Seguridad, 15),
  ('Sin rampines para Hiace', @t_Calidad, 15),
  ('Bandera sin funcionar', @t_Mantenimiento, 15),
  ('Checklist sin completar / firmar', @t_Calidad, 14),
  ('Comandos / palancas faltantes', @t_Calidad, 13),
  ('Matafuego descargado', @t_Seguridad, 12),
  ('Matafuego sin obleas', @t_Calidad, 11),
  ('Bidones sueltos en batea', @t_5s, 11),
  ('Tractor en mal estado', @t_Mantenimiento, 11),
  ('Soga precinto en mal estado / cortada', @t_Calidad, 11),
  ('Quebradura en batea', @t_Mantenimiento, 10),
  ('Electroválvulas / cables de bandera', @t_Mantenimiento, 9),
  ('Equipo sin armar / desarmado', @t_5s, 8),
  ('Pérdida de gasoil / combustible', @t_Mantenimiento, 7),
  ('Objetos sueltos en batea', @t_5s, 7),
  ('Guía de lona en mal estado', @t_Mantenimiento, 7),
  ('Lona trabada', @t_Calidad, 6),
  ('Neumático gastado', @t_Mantenimiento, 5),
  ('Paragolpe dañado', @t_Mantenimiento, 5),
  ('Sin soga precinto', @t_Calidad, 5),
  ('Manguera hidráulica rota / pinchada', @t_Mantenimiento, 5),
  ('No coinciden orificios de perno', @t_Mantenimiento, 4),
  ('Manguera rota / con pérdida', @t_Mantenimiento, 4),
  ('Perno trabado', @t_Calidad, 4),
  ('EPP fuera de lugar', @t_5s, 4),
  ('Espejo roto', @t_Seguridad, 4),
  ('Residuos en bahía', @t_5s, 4),
  ('Óxido y suciedad avanzada en batea', @t_5s, 3),
  ('Alarma de retroceso sin funcionar', @t_Calidad, 2),
  ('Espejo con fisura', @t_5s, 2),
  ('Reposera / objetos no permitidos', @t_Calidad, 2),
  ('Sin caballetes', @t_Calidad, 2),
  ('Faltante de espejo', @t_Calidad, 2),
  ('Falta de tapa de tanque', @t_Mantenimiento, 2),
  ('No funcionan comandos', @t_Calidad, 2),
  ('Desnivel de piso', @t_Calidad, 1),
  ('Sin control de batea', @t_Calidad, 1),
  ('Sin matafuego de cabina', @t_Seguridad, 1),
  ('Quebradura en posición A3', @t_Calidad, 1),
  ('Incidente en playa', @t_Seguridad, 1),
  ('Se rompe palanca de comando hidráulico durante la carga', @t_Mantenimiento, 1),
  ('Pisos sin acomodar', @t_Calidad, 1);

-- "Otro" aparecio 71 veces sin ningun campo donde decir que fue: esa
-- informacion se perdio. De ahora en mas exige detalle.
UPDATE desvio_catalogo SET requiere_detalle = 1 WHERE nombre = 'Otro';
