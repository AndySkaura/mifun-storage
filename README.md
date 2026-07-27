# TGFS

TGFS 是一个最小化的 Telegram 对象存储与虚拟文件系统：

- MySQL 仅保存目录、文件元数据和 Telegram 映射；
- 文件二进制只存储在 Telegram Channel；
- 上传和下载均使用 Node.js Stream，不写本地临时文件；
- 不包含用户、权限、分享、去重和上传任务系统。

## 环境要求

- Node.js 20+
- MySQL 8.x
- 一个 Telegram Bot
- 一个用于存储文件的 Telegram Channel

把 Bot 加入 Channel 并授予“发布消息”权限。Channel ID
通常形如 `-1001234567890`。

## 启动

```bash
cp .env.example .env
docker compose up -d
npm install
npm run prisma:deploy
npm run dev
```

在 `.env` 中填写真实的 `TELEGRAM_BOT_TOKEN` 和
`TELEGRAM_STORAGE_CHAT_ID`。默认服务地址为
`http://localhost:3000`。

生产环境：

```bash
npm run build
npm run prisma:deploy
npm start
```

## Docker 部署（外部 MySQL）

应用镜像不包含 MySQL。先在 `.env` 中把 `DATABASE_URL` 指向已有的
MySQL 8.x：

```env
DATABASE_URL=mysql://tgfs:password@mysql.example.com:3306/tgfs
TELEGRAM_BOT_TOKEN=1234567890:replace-with-real-token
TELEGRAM_STORAGE_CHAT_ID=-1001234567890
```

构建迁移镜像并执行一次数据库迁移：

```bash
docker build --target migrate -t tgfs-migrate .
docker run --rm --env-file .env tgfs-migrate
```

然后构建、运行精简的应用镜像：

```bash
docker build -t tgfs:latest .
docker run -d \
  --name tgfs \
  --restart unless-stopped \
  --env-file .env \
  -p 3000:3000 \
  tgfs:latest
```

容器中的 `HOST` 默认为 `0.0.0.0`，`PORT` 默认为 `3000`。如果外部
MySQL 只允许内网访问，应确保容器所在主机和 Docker 网络可以连接该地址。
`.env` 不会被复制进镜像。

## API

所有 ID 和文件大小均以 JSON 字符串返回，避免 JavaScript 对 MySQL
`BIGINT` 产生精度损失。

### 健康检查

```bash
curl http://localhost:3000/health
```

### 创建目录

```bash
curl -X POST http://localhost:3000/api/files/folder \
  -H 'content-type: application/json' \
  -d '{"name":"docs","parentId":null}'
```

### 查询目录

根目录：

```bash
curl http://localhost:3000/api/files
```

子目录：

```bash
curl 'http://localhost:3000/api/files?parentId=1'
```

### 查询单个条目

```bash
curl http://localhost:3000/api/files/1
```

### 上传文件

```bash
curl -X POST http://localhost:3000/api/files/upload \
  -F 'parentId=1' \
  -F 'file=@./example.pdf'
```

为保持真正的流式上传，multipart 请求中应先发送 `parentId` 字段，再发送
`file`。上传根目录时可以省略 `parentId`。也可通过查询参数传递：

```bash
curl -X POST 'http://localhost:3000/api/files/upload?parentId=1' \
  -F 'file=@./example.pdf'
```

默认最大文件大小为 50 MiB，可通过 `MAX_UPLOAD_SIZE` 调整，但实际限制还受
Telegram Bot API 约束。

### 下载文件

```bash
curl -OJ http://localhost:3000/api/files/2/download
```

服务从 Telegram 获取文件流并直接转发给 HTTP 客户端，不落盘。

### 逻辑删除文件或目录

```bash
curl -i -X DELETE http://localhost:3000/api/files/2
```

删除操作只设置 `files.deleted_at`，不会删除 `files`、
`telegram_files` 或 Telegram Channel 中的消息。删除目录时会递归标记其
全部子目录和文件；默认查询只返回 `deleted_at IS NULL` 的记录。

### 复制文件或文件夹

```bash
curl -X POST http://localhost:3000/api/files/2/copy \
  -H 'content-type: application/json' \
  -d '{"parentId":1}'
```

文件复制只创建新的 MySQL 虚拟文件记录，并复用原有的 Telegram
`chat_id`、`message_id` 和 `file_id`，不会调用 Telegram API 或创建新的
Channel 消息。文件夹会递归复制其子目录和文件，不能粘贴到自身或自己的
子目录。复制得到的文件和文件夹不会继承源项目的标签关联。

### 标签

系统内置红、橙、黄、绿、蓝、紫、粉、灰 8 种标签。查询标签：

```bash
curl http://localhost:3000/api/tags
```

为文件或文件夹设置标签（传空数组可移除全部标签）：

```bash
curl -X PUT http://localhost:3000/api/files/2/tags \
  -H 'content-type: application/json' \
  -d '{"tags":["red","blue"]}'
```

按标签查询所有未删除的文件和文件夹：

```bash
curl http://localhost:3000/api/files/by-tag/red
```

移除标签时只设置 `file_tags.deleted_at`，不会物理删除标签关联记录。

## Web 文件管理器

访问服务根路径 `/` 即可使用 Finder 风格文件管理器。支持：

- 双击打开文件夹或下载文件；
- 右键新建文件夹、复制、粘贴、上传和删除；
- 在文件或文件夹右键菜单中设置 8 色标签，并通过侧边栏按标签筛选；
- `⌘C`、`⌘V`、`⇧⌘C`（复制下载链接）、`⇧⌘N`、`⌘U`
  快捷键；
- 把本地文件直接拖入页面上传到当前目录；
- 显示按文件大小加权的总上传进度，以及每个文件的等待、上传、
  Telegram 存储、完成和失败状态；
- 使用 macOS 风格的新建/删除对话框和统一 Toast 通知；
- 显示加载骨架、空目录、搜索无结果及加载失败重试状态；
- 底部显示可点击的真实目录面包屑路径；
- 网格/列表视图和当前目录搜索。

## 开发命令

```bash
npm run typecheck
npm test
npm run build
```

Prisma Schema 位于 `prisma/schema.prisma`，初始迁移位于
`prisma/migrations/20260727000000_init/`。
