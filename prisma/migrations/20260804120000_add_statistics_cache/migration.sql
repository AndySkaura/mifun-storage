CREATE TABLE `statistics_cache` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `generated_at` DATETIME(3) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idx_statistics_cache_expires_at`(`expires_at`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
