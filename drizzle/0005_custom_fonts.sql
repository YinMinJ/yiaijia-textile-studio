CREATE TABLE `fonts` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_id` text NOT NULL,
  `object_key` text NOT NULL,
  `name` text NOT NULL,
  `mime` text NOT NULL,
  `bytes` integer NOT NULL CHECK (`bytes` > 0),
  `created_at` text NOT NULL
);
CREATE INDEX `idx_fonts_owner_created` ON `fonts` (`owner_id`, `created_at`);
