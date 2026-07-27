-- CreateTable
CREATE TABLE `files` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `parent_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` ENUM('file', 'folder') NOT NULL,
    `size` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `mime_type` VARCHAR(100) NULL,
    `extension` VARCHAR(20) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_parent_id`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `telegram_files` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `file_id` BIGINT UNSIGNED NOT NULL,
    `telegram_chat_id` BIGINT NOT NULL,
    `telegram_message_id` BIGINT NOT NULL,
    `telegram_file_id` VARCHAR(255) NOT NULL,
    `telegram_file_unique_id` VARCHAR(255) NULL,
    `file_size` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `telegram_files_file_id_key`(`file_id`),
    UNIQUE INDEX `uk_message`(`telegram_chat_id`, `telegram_message_id`),
    INDEX `idx_file_id`(`file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `telegram_files`
ADD CONSTRAINT `telegram_files_file_id_fkey`
FOREIGN KEY (`file_id`) REFERENCES `files`(`id`)
ON DELETE CASCADE ON UPDATE CASCADE;
