ALTER TABLE `storage_locations`
  ADD COLUMN `anonymous_tag_access` ENUM('hidden', 'read', 'write')
  NOT NULL DEFAULT 'read' AFTER `anonymous_access`;
