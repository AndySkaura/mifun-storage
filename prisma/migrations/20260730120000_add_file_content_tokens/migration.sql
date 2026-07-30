ALTER TABLE `files`
  ADD COLUMN `content_token` VARCHAR(64) NULL;

UPDATE `files`
SET `content_token` = LOWER(HEX(RANDOM_BYTES(32)))
WHERE `type` = 'file' AND `content_token` IS NULL;

CREATE UNIQUE INDEX `files_content_token_key`
  ON `files`(`content_token`);
