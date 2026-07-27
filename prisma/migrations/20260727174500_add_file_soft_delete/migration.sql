-- AlterTable
ALTER TABLE `files`
ADD COLUMN `deleted_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `idx_deleted_at` ON `files`(`deleted_at`);
