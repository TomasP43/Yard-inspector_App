-- ============================================================================
-- Migracion de las fotos historicas de AppSheet.
--
-- Las ~8.700 fotos del historico viven hoy en Google Drive, bajo rutas como
-- "Form Responses 1_Images/03-27-2025 15-33-59.Fotografias del desvio.183549.jpg".
-- Los registros se migran ahora; los archivos, despues.
--
-- Por eso `ruta` pasa a ser NULL-able y aparece `ruta_origen`:
--   ruta_origen = donde estaba en AppSheet (siempre se conserva)
--   ruta        = donde esta en este servidor (NULL = todavia no se copio)
--
-- Asi el frontend sabe que la foto existe pero no esta disponible, en vez de
-- intentar cargar un archivo inexistente y mostrar un roto.
-- ============================================================================

ALTER TABLE inspeccion_foto
  MODIFY COLUMN ruta VARCHAR(255) NULL,
  ADD COLUMN ruta_origen VARCHAR(255) NULL AFTER ruta,
  ADD KEY ix_foto_pendiente (ruta, ruta_origen);

ALTER TABLE inspeccion
  ADD COLUMN foto_checklist_origen VARCHAR(255) NULL AFTER foto_checklist;

-- Marca las inspecciones que vienen de AppSheet, para poder distinguirlas de
-- las que se cargan desde la app nueva (y para poder deshacer la migracion).
ALTER TABLE inspeccion
  ADD COLUMN origen ENUM('app','appsheet') NOT NULL DEFAULT 'app' AFTER uuid,
  ADD KEY ix_inspeccion_origen (origen);

-- Cuantas fotos quedan por copiar desde Drive.
CREATE OR REPLACE VIEW v_fotos_pendientes AS
  SELECT f.id, f.inspeccion_id, f.orden, f.ruta_origen, i.registrado_en
    FROM inspeccion_foto f
    JOIN inspeccion i ON i.id = f.inspeccion_id
   WHERE f.ruta IS NULL AND f.ruta_origen IS NOT NULL;
