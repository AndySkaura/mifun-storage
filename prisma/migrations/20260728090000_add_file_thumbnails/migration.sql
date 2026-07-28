ALTER TABLE `telegram_files`
  ADD COLUMN `thumbnail_file_id` VARCHAR(255) NULL,
  ADD COLUMN `thumbnail_file_unique_id` VARCHAR(255) NULL,
  ADD COLUMN `thumbnail_width` SMALLINT UNSIGNED NULL,
  ADD COLUMN `thumbnail_height` SMALLINT UNSIGNED NULL,
  ADD COLUMN `thumbnail_file_size` BIGINT UNSIGNED NULL;
