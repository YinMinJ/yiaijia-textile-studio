-- Use the exact ID returned by the configured B.AI models endpoint.
UPDATE model_settings
SET text_model = 'deepseek-v4.1-flash'
WHERE protocol IN ('custom', 'openai')
  AND (base_url = 'https://api.b.ai' OR base_url LIKE 'https://api.b.ai/%')
  AND text_model = 'DeepSeek-V4.1-Flash';
