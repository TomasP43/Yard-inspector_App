-- ============================================================================
-- Desvios agregados por el inspector desde la app.
--
-- Cuando aparece algo que no esta en el catalogo, el inspector lo escribe y
-- queda guardado para todos. Para que eso no degenere en el mismo desorden que
-- tenia AppSheet (78 grafias para 71 conceptos), hay dos controles:
--
--   1. Duplicado exacto: ya lo resuelve la base. La tabla usa la colacion
--      utf8mb4_0900_ai_ci, que ignora acentos y mayusculas, asi que el UNIQUE
--      sobre `nombre` hace que 'Oxido en batea' choque con 'Óxido en batea'.
--      Ese era el caso mas frecuente en el historico.
--
--   2. Parecido pero no igual: no se puede resolver solo. Se le sugieren al
--      inspector los candidatos antes de crear, y si aun asi crea uno nuevo,
--      queda marcado con revisar=1 para que un supervisor lo mire despues.
--      Nunca se fusiona por adivinanza: preferimos un duplicado visible a
--      perder un desvio real bajo otro nombre.
-- ============================================================================

ALTER TABLE desvio_catalogo
  ADD COLUMN creado_por_usuario_id INT UNSIGNED NULL AFTER usos_historicos,
  ADD COLUMN creado_en TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP AFTER creado_por_usuario_id,
  -- 1 = lo creo un inspector y todavia no lo valido nadie
  ADD COLUMN revisar TINYINT(1) NOT NULL DEFAULT 0 AFTER creado_en,
  ADD KEY ix_desvio_revisar (revisar),
  ADD CONSTRAINT fk_desvio_creador FOREIGN KEY (creado_por_usuario_id)
    REFERENCES usuario (id) ON DELETE SET NULL;

-- Los 71 del catalogo original vienen del historico de AppSheet, no de un
-- inspector, y ya estan validados.
UPDATE desvio_catalogo SET revisar = 0, creado_en = NULL WHERE creado_por_usuario_id IS NULL;

-- Cola de revision para el supervisor.
CREATE OR REPLACE VIEW v_desvios_a_revisar AS
  SELECT d.id, d.nombre, d.tipo_desvio_id, d.creado_en, u.email AS creado_por,
         (SELECT COUNT(*) FROM inspeccion_desvio x WHERE x.desvio_id = d.id) AS usos
    FROM desvio_catalogo d
    LEFT JOIN usuario u ON u.id = d.creado_por_usuario_id
   WHERE d.revisar = 1
   ORDER BY d.creado_en DESC;
