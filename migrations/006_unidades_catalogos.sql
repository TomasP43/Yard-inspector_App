-- ============================================================================
-- Catalogos del modulo de inspeccion de unidades.
-- Generado desde las planillas de AppSheet. Ver tools/README.md.
--
-- Los nombres van en castellano porque es lo que viene del origen. Las
-- traducciones a portugues e ingles se cargan en la tabla 	raduccion, que
-- permite sumar idiomas sin tocar ninguna de estas tablas.
-- ============================================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------------ idiomas
INSERT INTO idioma (codigo, nombre, orden) VALUES
  ('es', 'Espanol', 1),
  ('pt', 'Portugues', 2),
  ('en', 'English', 3);

-- ------------------------------------------------------------------- roles
INSERT INTO rol (codigo, nombre) VALUES
  ('admin',      'Administrador'),
  ('supervisor', 'Supervisor'),
  ('inspector',  'Inspector'),
  ('lectura',    'Solo lectura');

-- ------------------------------------------------------------------ playas
INSERT INTO playa (codigo, nombre, pais) VALUES
  ('SOR', 'Sorocaba',   'Brasil'),
  ('IND', 'Indaiatuba', 'Brasil'),
  ('ZAR', 'Zarate',     'Argentina');

-- ---------------------------------------------------------------- destinos
-- Del catalogo de distribuidores de AppSheet mas los destinos de los flujos.
INSERT INTO destino (nombre, pais) VALUES
  ('TDB',             'Brasil'),
  ('Guaiba',          'Brasil'),
  ('TCL',             'Chile'),
  ('Toyotoshi',       'Paraguay'),
  ('Ayax',            'Uruguay'),
  ('Toyosa',          'Bolivia'),
  ('Terminal Zarate', 'Argentina'),
  ('Puerto',          NULL),
  ('Cruce',           NULL),
  ('Celentano',       NULL);

-- ------------------------------------------------------------------ flujos
INSERT INTO flujo (nombre, playa_origen_id, destino_id, orden) VALUES
  ('Sorocaba - Zarate',   (SELECT id FROM playa WHERE codigo='SOR'), (SELECT id FROM destino WHERE nombre='Terminal Zarate'), 1),
  ('Indaiatuba - Zarate', (SELECT id FROM playa WHERE codigo='IND'), (SELECT id FROM destino WHERE nombre='Terminal Zarate'), 2),
  ('TASA - Guaiba',       (SELECT id FROM playa WHERE codigo='ZAR'), (SELECT id FROM destino WHERE nombre='Guaiba'),          3),
  ('TASA - TCL',          (SELECT id FROM playa WHERE codigo='ZAR'), (SELECT id FROM destino WHERE nombre='TCL'),             4),
  ('TASA - Toyosa',       (SELECT id FROM playa WHERE codigo='ZAR'), (SELECT id FROM destino WHERE nombre='Toyosa'),          5);

-- ------------------------------------------------------------------ etapas
-- Los cinco flujos arrancan con las mismas tres etapas. Son filas, no un ENUM:
-- el administrador puede agregar, reordenar o desactivar sin migracion.
INSERT INTO etapa (flujo_id, nombre, orden, requiere_foto_panoramica, requiere_firma_inspector, requiere_foto_por_dano, permite_sin_danos)
SELECT f.id, e.nombre, e.orden, e.pano, e.firma, e.fotod, e.sind
  FROM flujo f
  CROSS JOIN (
    SELECT 'Precarga' AS nombre, 1 AS orden, 1 AS pano, 1 AS firma, 1 AS fotod, 1 AS sind
    UNION ALL SELECT 'Carga',    2, 0, 1, 1, 1
    UNION ALL SELECT 'Descarga', 3, 1, 1, 1, 1
  ) e;

-- ---------------------------------------------------------------- gravedad
-- El tercer codigo del estandar Furlong, el que hoy no se registra.
INSERT INTO gravedad (codigo, nombre, desde_cm, hasta_cm, orden) VALUES
  (0, 'Sin excepcion',                     NULL, NULL, 1),
  (1, 'Hasta 2,5 cm',                      NULL,  2.5, 2),
  (2, 'Mayor a 2,5 y hasta 7,5 cm',         2.5,  7.5, 3),
  (3, 'Mayor a 7,5 y hasta 15 cm',          7.5, 15.0, 4),
  (4, 'Mayor a 15 y hasta 30 cm',          15.0, 30.0, 5),
  (5, 'Mayor a 30 cm',                     30.0, NULL, 6),
  (6, 'Sustitucion / dano severo / faltante', NULL, NULL, 7);

-- ------------------------------------------------------------------ modelos
INSERT INTO modelo (nombre) VALUES
  ('Hilux'), ('Fortuner'), ('Corolla Cross'), ('Corolla'),
  ('Yaris'), ('Hiace'), ('Lexus'), ('GR86');

-- ------------------------------------------------------------------- partes
-- cantidad_cuadrantes sale del estandar de localizacion de danos:
-- 9 para superficies grandes, 3 para pilares/rieles/zocalos, 1 donde no aplica.
INSERT INTO parte (nombre, grupo, cantidad_cuadrantes, orden) VALUES
  ('Paragolpe delantero', 'Exterior', 9, 1),
  ('Paragolpe trasero', 'Exterior', 9, 2),
  ('Protector paragolpe / fleje', 'Exterior', 3, 3),
  ('Guardabarro delantero derecho', 'Exterior', 9, 4),
  ('Guardabarro delantero izquierdo', 'Exterior', 9, 5),
  ('Guardabarro trasero derecho', 'Exterior', 9, 6),
  ('Guardabarro trasero izquierdo', 'Exterior', 9, 7),
  ('Capot', 'Exterior', 9, 8),
  ('Parrilla', 'Exterior', 1, 9),
  ('Antena', 'Exterior', 1, 10),
  ('Espejo exterior derecho', 'Exterior', 1, 11),
  ('Espejo exterior izquierdo', 'Exterior', 1, 12),
  ('Parabrisas delantero', 'Exterior', 1, 13),
  ('Luneta trasera', 'Exterior', 1, 14),
  ('Vidrios laterales (delanteros y traseros)', 'Exterior', 1, 15),
  ('Optica delantera derecha', 'Exterior', 1, 16),
  ('Optica delantera izquierda', 'Exterior', 1, 17),
  ('Optica trasera derecha', 'Exterior', 1, 18),
  ('Optica trasera izquierda', 'Exterior', 1, 19),
  ('Sensores de estacionamiento', 'Exterior', 1, 20),
  ('Techo', 'Exterior', 9, 21),
  ('Techo corredizo / Capota textil', 'Exterior', 9, 22),
  ('Portaequipaje / Barras de techo', 'Exterior', 3, 23),
  ('Estribo lateral derecho', 'Exterior', 3, 24),
  ('Estribo lateral izquierdo', 'Exterior', 3, 25),
  ('Tazas de ruedas', 'Exterior', 1, 26),
  ('Llantas', 'Exterior', 1, 27),
  ('Neumáticos (no de auxilio)', 'Exterior', 1, 28),
  ('Neumático / Rueda auxiliar', 'Exterior', 1, 29),
  ('Tapa de carga de combustible', 'Exterior', 1, 30),
  ('Tanque de nafta', 'Exterior', 1, 31),
  ('Puerta delantera derecha', 'Exterior', 9, 32),
  ('Puerta delantera izquierda', 'Exterior', 9, 33),
  ('Puerta trasera derecha', 'Exterior', 9, 34),
  ('Puerta trasera izquierda', 'Exterior', 9, 35),
  ('Puerta cabina cucheta derecha (si aplica)', 'Exterior', 9, 36),
  ('Puerta de carga (Hiace / pick-up)', 'Exterior', 9, 37),
  ('Zócalo lateral derecho', 'Exterior', 3, 38),
  ('Zócalo lateral izquierdo', 'Exterior', 3, 39),
  ('Pilar delantero derecho', 'Exterior', 3, 40),
  ('Pilar delantero izquierdo', 'Exterior', 3, 41),
  ('Pilar medio derecho', 'Exterior', 3, 42),
  ('Pilar medio izquierdo', 'Exterior', 3, 43),
  ('Pilar trasero derecho', 'Exterior', 3, 44),
  ('Pilar trasero izquierdo', 'Exterior', 3, 45),
  ('Asiento delantero derecho', 'Interior', 1, 46),
  ('Asiento delantero izquierdo', 'Interior', 1, 47),
  ('Asiento trasero', 'Interior', 1, 48),
  ('Alfombra delantera', 'Interior', 1, 49),
  ('Alfombra trasera', 'Interior', 1, 50),
  ('Tapizados (asientos y puertas)', 'Interior', 1, 51),
  ('Paneles interiores de puertas', 'Interior', 1, 52),
  ('Cinturones de seguridad (todos)', 'Interior', 1, 53),
  ('Airbags (conductor, acompañante, laterales, cortina)', 'Interior', 1, 54),
  ('Cubretablero', 'Interior', 1, 55),
  ('Volante', 'Interior', 1, 56),
  ('Palanca de cambios', 'Interior', 1, 57),
  ('Encendedor / Cenicero', 'Interior', 1, 58),
  ('Llaves', 'Interior', 1, 59),
  ('Tablero digital / velocímetro', 'Interior', 1, 60),
  ('Pantalla multimedia', 'Interior', 1, 61),
  ('Sistema de audio', 'Interior', 1, 62),
  ('Cámara / sensores (vista interior)', 'Interior', 1, 63),
  ('Interior caja pick-up (Hilux)', 'Interior', 9, 64),
  ('Interior compartimiento trasero (Hiace)', 'Interior', 9, 65),
  ('Convertidor catalítico', 'Mecanica', 1, 66),
  ('Radiador (visible)', 'Mecanica', 1, 67),
  ('Batería (visible)', 'Mecanica', 1, 68),
  ('Filtro de aire (visible)', 'Mecanica', 1, 69),
  ('Herramientas / Gato / Kit / Traba auxiliar', 'Mecanica', 1, 70);

-- Cuantas veces se uso cada parte en el historico: ordena la pantalla del
-- inspector para que lo mas frecuente quede arriba. Cuatro partes concentran
-- el 55% de los danos.
UPDATE parte SET usos_historicos = 514 WHERE nombre = 'Puerta trasera izquierda';
UPDATE parte SET usos_historicos = 424 WHERE nombre = 'Puerta delantera derecha';
UPDATE parte SET usos_historicos = 412 WHERE nombre = 'Puerta delantera izquierda';
UPDATE parte SET usos_historicos = 277 WHERE nombre = 'Paragolpe delantero';
UPDATE parte SET usos_historicos = 204 WHERE nombre = 'Puerta trasera derecha';
UPDATE parte SET usos_historicos = 180 WHERE nombre = 'Guardabarro trasero izquierdo';
UPDATE parte SET usos_historicos = 159 WHERE nombre = 'Zócalo lateral izquierdo';
UPDATE parte SET usos_historicos = 132 WHERE nombre = 'Guardabarro trasero derecho';
UPDATE parte SET usos_historicos = 92 WHERE nombre = 'Paragolpe trasero';
UPDATE parte SET usos_historicos = 68 WHERE nombre = 'Guardabarro delantero izquierdo';
UPDATE parte SET usos_historicos = 66 WHERE nombre = 'Guardabarro delantero derecho';
UPDATE parte SET usos_historicos = 40 WHERE nombre = 'Pilar medio izquierdo';
UPDATE parte SET usos_historicos = 34 WHERE nombre = 'Capot';
UPDATE parte SET usos_historicos = 27 WHERE nombre = 'Zócalo Delantero Izquierdo';
UPDATE parte SET usos_historicos = 20 WHERE nombre = 'Puerta de carga (Hiace / pick-up)';
UPDATE parte SET usos_historicos = 20 WHERE nombre = 'Tapa de carga de combustible';
UPDATE parte SET usos_historicos = 20 WHERE nombre = 'Espejo exterior izquierdo';
UPDATE parte SET usos_historicos = 18 WHERE nombre = 'Sensores de estacionamiento';
UPDATE parte SET usos_historicos = 18 WHERE nombre = 'Portaequipaje / Barras de techo';
UPDATE parte SET usos_historicos = 15 WHERE nombre = 'Asiento trasero';
UPDATE parte SET usos_historicos = 14 WHERE nombre = 'Optica trasera derecha';
UPDATE parte SET usos_historicos = 11 WHERE nombre = 'Pilar trasero derecho';
UPDATE parte SET usos_historicos = 11 WHERE nombre = 'Zócalo lateral derecho';
UPDATE parte SET usos_historicos = 9 WHERE nombre = 'Tapizados (asientos y puertas)';
UPDATE parte SET usos_historicos = 8 WHERE nombre = 'Optica delantera izquierda';
UPDATE parte SET usos_historicos = 8 WHERE nombre = 'Estribo lateral izquierdo';
UPDATE parte SET usos_historicos = 7 WHERE nombre = 'Puerta Trasero Derecho';
UPDATE parte SET usos_historicos = 6 WHERE nombre = 'Optica trasera izquierda';
UPDATE parte SET usos_historicos = 5 WHERE nombre = 'Optica delantera derecha';
UPDATE parte SET usos_historicos = 5 WHERE nombre = 'Cámara / sensores (vista interior)';
UPDATE parte SET usos_historicos = 4 WHERE nombre = 'Pilar delantero derecho';
UPDATE parte SET usos_historicos = 4 WHERE nombre = 'Techo';
UPDATE parte SET usos_historicos = 4 WHERE nombre = 'Pilar trasero izquierdo';
UPDATE parte SET usos_historicos = 4 WHERE nombre = 'Luneta trasera';
UPDATE parte SET usos_historicos = 3 WHERE nombre = 'Pilar delantero izquierdo';
UPDATE parte SET usos_historicos = 3 WHERE nombre = 'Interior caja pick-up (Hilux)';
UPDATE parte SET usos_historicos = 3 WHERE nombre = 'Puerta Delantero Izquierdo';
UPDATE parte SET usos_historicos = 3 WHERE nombre = 'Pilar medio derecho';
UPDATE parte SET usos_historicos = 3 WHERE nombre = 'Neumático / Rueda auxiliar';
UPDATE parte SET usos_historicos = 3 WHERE nombre = 'Pilar central Izquierdo';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Herramientas / Gato / Kit / Traba auxiliar';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Tapabarro Delantero Izquierdo';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Zócalo Trasero Derecho';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Puerta Delantero Derecho';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Paneles interiores de puertas';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Portalón Trasero';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Tazas de ruedas';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Estribo lateral derecho';
UPDATE parte SET usos_historicos = 2 WHERE nombre = 'Puerta Trasero Izquierdo';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Llantas';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Puerta cabina cucheta derecha (si aplica)';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Interior compartimiento trasero (Hiace)';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Parachoques Trasero';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Convertidor catalítico';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Asiento delantero izquierdo';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Cubretablero';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Espejo exterior derecho';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Tanque de nafta';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Neumáticos (no de auxilio)';
UPDATE parte SET usos_historicos = 1 WHERE nombre = 'Parrilla';

-- -------------------------------------------------------------- tipo de dano
-- Los 14 del catalogo oficial. El ultimo aparecio en los datos y no estaba en
-- el catalogo, asi que entra con revisar=1.
INSERT INTO tipo_dano (nombre, usos_historicos, revisar) VALUES
  ('Abollado', 1203, 0),
  ('Rayado', 1041, 0),
  ('Fallo de pintura', 347, 0),
  ('Filo de panel', 81, 0),
  ('Desprendido', 60, 0),
  ('Contaminado (No daño)', 55, 0),
  ('Mellado', 43, 0),
  ('Roto', 25, 0),
  ('Perforado', 11, 0),
  ('Faltante', 6, 0),
  ('Derrame de fluido', 3, 0),
  ('Vidrio roto', 3, 0),
  ('Doblado', 3, 0),
  ('Cortado', 1, 0),
  ('Desmontado', 2, 1);

-- ----------------------------------------------------------- detalle del dano
-- Salen del campo Comentario, que ya venia funcionando como catalogo. Solo los
-- que se usaron 3 veces o mas: con 1 o 2 usos es texto libre, no un concepto.
INSERT INTO detalle_dano (nombre, usos_historicos) VALUES
  ('Malformacion', 309),
  ('Semilla en laca', 75),
  ('Filo en Puerta', 61),
  ('Rayado', 50),
  ('Pintura saltada', 45),
  ('Filo interno', 34),
  ('Filo de puerta', 30),
  ('Bollo', 17),
  ('Raspado', 14),
  ('Abollada', 9),
  ('Malfromacion', 9),
  ('Varios', 8),
  ('Sensor desprendido', 8),
  ('Malformación de chapa', 7),
  ('Filo interno en puerta trasera izquierda', 7),
  ('Abollado', 7),
  ('Malformacion en pintura', 7),
  ('Filo interno en puerta', 6),
  ('Rayado debajo de optica', 5),
  ('Rallado', 5),
  ('Paragolpe lado derecho', 5),
  ('Lado derecho', 5),
  ('X2', 5),
  ('Varias', 5),
  ('Raya', 5),
  ('Excremento de ave', 4),
  ('Manchado', 4),
  ('Sobrante de pintura', 3),
  ('Malformaciom', 3),
  ('Exceso en pintura', 3),
  ('Luz suelta', 3),
  ('Filo interno puerta trasera izquierda', 3),
  ('Luz trasera suelta', 3),
  ('Exceso de pintura', 3);