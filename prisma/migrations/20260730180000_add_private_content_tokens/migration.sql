ALTER TABLE `files`
  ADD COLUMN `private_content_token` VARCHAR(64) NULL;

UPDATE `files`
SET `private_content_token` = REPLACE(
  REPLACE(
    REPLACE(TO_BASE64(RANDOM_BYTES(16)), '+', '-'),
    '/',
    '_'
  ),
  '=',
  ''
)
WHERE `type` = 'file' AND `private_content_token` IS NULL;

CREATE UNIQUE INDEX `files_private_content_token_key`
  ON `files`(`private_content_token`);
