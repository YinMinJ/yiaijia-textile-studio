-- Keep existing custom providers on their previous square/default-quality path.
ALTER TABLE model_settings ADD COLUMN image_quality TEXT NOT NULL DEFAULT 'auto'
  CHECK (image_quality IN ('auto', 'high', 'medium', 'low'));
ALTER TABLE model_settings ADD COLUMN image_resolution TEXT NOT NULL DEFAULT '1k'
  CHECK (image_resolution IN ('1k', '2k'));
