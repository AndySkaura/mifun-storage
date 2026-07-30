ALTER TABLE `files`
  ADD COLUMN `content_token` VARCHAR(64) NULL;

UPDATE `files`
SET `content_token` = REPLACE(
  REPLACE(
    REPLACE(TO_BASE64(RANDOM_BYTES(16)), '+', '-'),
    '/',
    '_'
  ),
  '=',
  ''
)
WHERE `type` = 'file' AND `content_token` IS NULL;

CREATE UNIQUE INDEX `files_content_token_key`
  ON `files`(`content_token`);
