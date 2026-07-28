CREATE TABLE `storage_locations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `anonymous_access` ENUM('hidden', 'read', 'write') NOT NULL DEFAULT 'read',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `storage_locations_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `storage_locations` (`id`, `name`, `anonymous_access`)
VALUES (1, 'C盘', 'write');

ALTER TABLE `files`
    ADD COLUMN `storage_location_id` BIGINT UNSIGNED NULL;

UPDATE `files` SET `storage_location_id` = 1;

ALTER TABLE `files`
    MODIFY `storage_location_id` BIGINT UNSIGNED NOT NULL,
    ADD INDEX `idx_storage_parent`(`storage_location_id`, `parent_id`),
    ADD CONSTRAINT `files_storage_location_id_fkey`
        FOREIGN KEY (`storage_location_id`) REFERENCES `storage_locations`(`id`)
        ON DELETE RESTRICT ON UPDATE CASCADE;
