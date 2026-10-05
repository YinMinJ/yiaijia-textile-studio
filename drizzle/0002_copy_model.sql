ALTER TABLE model_settings ADD COLUMN text_model TEXT NOT NULL DEFAULT '';

UPDATE model_settings
SET text_model = 'DeepSeek-V4.1-Flash'
WHERE protocol IN ('custom', 'openai')
  AND (base_url = 'https://api.b.ai' OR base_url LIKE 'https://api.b.ai/%');
