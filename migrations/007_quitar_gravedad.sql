-- ============================================================================
-- Saca el codigo de gravedad del modelo de danos.
--
-- Se habia incorporado leyendo "Procedimiento de revision de unidades.pptx",
-- que describe el check list en papel con tres codigos
-- (AREA - TIPO DE DANO - GRAVEDAD). Ese proceso ya no esta vigente: el
-- estandar que se usa es el de localizacion de danos 2024, que es de donde
-- sale el cuadrante, y no pide el tamano.
--
-- El cuadrante SI se mantiene: es ubicacion dentro de la pieza y es parte del
-- proceso actual.
--
-- Va como migracion nueva en vez de editar la 005 y la 006 porque el deploy
-- es automatico en cada push: lo mas probable es que aquellas ya se hayan
-- aplicado en el VPS. Asi el resultado es el mismo sobre una base que ya las
-- corrio y sobre una base nueva.
-- ============================================================================

SET NAMES utf8mb4;

-- El FK primero: MySQL no deja soltar la tabla mientras lo apunte.
ALTER TABLE inspeccion_dano DROP FOREIGN KEY fk_dano_gravedad;
ALTER TABLE inspeccion_dano DROP COLUMN gravedad_id;

DROP TABLE IF EXISTS gravedad;
