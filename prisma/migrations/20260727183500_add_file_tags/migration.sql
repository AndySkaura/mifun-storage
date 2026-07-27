-- CreateTable
CREATE TABLE `tags` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(20) NOT NULL,
    `name` VARCHAR(30) NOT NULL,
    `color` VARCHAR(20) NOT NULL,
    `sort_order` TINYINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `tags_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `file_tags` (
    `file_id` BIGINT UNSIGNED NOT NULL,
    `tag_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deleted_at` DATETIME(3) NULL,

    INDEX `idx_file_tags_tag_id`(`tag_id`),
    INDEX `idx_file_tags_deleted_at`(`deleted_at`),
    PRIMARY KEY (`file_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `file_tags`
ADD CONSTRAINT `file_tags_file_id_fkey`
FOREIGN KEY (`file_id`) REFERENCES `files`(`id`)
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `file_tags`
ADD CONSTRAINT `file_tags_tag_id_fkey`
FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`)
ON DELETE CASCADE ON UPDATE CASCADE;

-- SeedData
INSERT INTO `tags` (`slug`, `name`, `color`, `sort_order`) VALUES
    ('red', '红色', '#ef4444', 1),
    ('orange', '橙色', '#f97316', 2),
    ('yellow', '黄色', '#eab308', 3),
    ('green', '绿色', '#22c55e', 4),
    ('blue', '蓝色', '#3b82f6', 5),
    ('purple', '紫色', '#a855f7', 6),
    ('pink', '粉色', '#ec4899', 7),
    ('gray', '灰色', '#94a3b8', 8);
