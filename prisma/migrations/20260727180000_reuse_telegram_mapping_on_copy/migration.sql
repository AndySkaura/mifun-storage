-- 复制文件时允许多条虚拟文件记录复用同一 Telegram 消息。
DROP INDEX `uk_message` ON `telegram_files`;

CREATE INDEX `idx_telegram_message`
ON `telegram_files`(`telegram_chat_id`, `telegram_message_id`);
