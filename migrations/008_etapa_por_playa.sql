-- ============================================================================
-- La etapa define en que playa ocurre.
--
-- El modelo anterior ataba el viaje a una sola playa, la de origen, y la
-- pantalla del inspector filtraba por ahi. Eso rompia el caso mas comun de los
-- flujos de importacion: un viaje Sorocaba -> Zarate tiene la precarga y la
-- carga en Brasil pero **la descarga en Zarate**, y el inspector de Zarate
-- nunca lo veia, porque para el sistema era un viaje de Sorocaba.
--
-- Ahora cada etapa puede declarar su playa. NULL significa "la de origen del
-- viaje", que es lo correcto para los flujos que ocurren enteros en un lugar y
-- evita tener que completar el dato en todos lados.
--
--   playa efectiva de una etapa = COALESCE(etapa.playa_id, viaje.playa_id)
-- ============================================================================

SET NAMES utf8mb4;

ALTER TABLE etapa
  ADD COLUMN playa_id INT UNSIGNED NULL AFTER flujo_id,
  ADD KEY ix_etapa_playa (playa_id),
  ADD CONSTRAINT fk_etapa_playa FOREIGN KEY (playa_id) REFERENCES playa (id);

-- Los flujos que vienen de Brasil descargan en Zarate.
UPDATE etapa e
  JOIN flujo f ON f.id = e.flujo_id
  JOIN playa po ON po.id = f.playa_origen_id
  SET e.playa_id = (SELECT id FROM playa WHERE codigo = 'ZAR')
WHERE e.nombre = 'Descarga'
  AND po.codigo IN ('SOR', 'IND');

-- Los flujos de exportacion (TASA -> Guaiba / TCL / Toyosa) descargan en el
-- destino, que no es una playa nuestra. Quedan en NULL: si mas adelante se
-- decide no inspeccionar alla, se desactiva la etapa desde el panel en vez de
-- borrarla, para no perder las inspecciones ya cargadas.

-- Que etapa le toca a cada playa, resuelto de una.
CREATE OR REPLACE VIEW v_etapa_playa AS
  SELECT e.id AS etapa_id, e.flujo_id, e.nombre AS etapa, e.orden, e.activo,
         COALESCE(e.playa_id, f.playa_origen_id) AS playa_id
    FROM etapa e
    JOIN flujo f ON f.id = e.flujo_id;
