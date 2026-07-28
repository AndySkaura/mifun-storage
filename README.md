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
ADMIN_TOKEN=
MAX_UPLOAD_SIZE=52428800
MAX_DOWNLOAD_SIZE=20971520
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

## 管理员鉴权

`ADMIN_TOKEN` 未配置或留空时关闭管理员鉴权，所有操作均允许匿名访问。
配置非空 Token 后，删除项目和管理存储位置属于管理员操作，要求以下请求头：

```http
Authorization: Bearer <ADMIN_TOKEN>
```

上传、创建文件夹和粘贴（复制项目）允许匿名访问；文件列表、搜索、下载、
图片预览和缩略图接口也保持公开。非空 Token 没有字符长度限制；生产环境
仍建议使用 32 字节随机值：

```bash
openssl rand -hex 32
```

Web 文件管理器右上角提供“管理员登录”。验证成功后，Token 仅保存在当前
标签页的 `sessionStorage` 中，关闭标签页即失效；不要把 Token 放进 URL、
下载链接或前端源码。

## 存储位置

存储位置是相互独立的一级空间，底层隔离方式类似多个磁盘分区，但界面仍
保持云端存储的表现形式。迁移会创建默认的 `TGFS`，并把已有文件归入其中。
管理员可以新增、修改和删除空的存储位置，
并为每个位置设置匿名权限：

- `hidden`：匿名用户不可见，也不能通过接口直接访问；
- `read`：匿名用户可以浏览、搜索、预览、下载和筛选标签，但不能写入或修改标签；
- `write`：匿名用户还可以上传、创建文件夹、粘贴项目和修改标签。

管理员登录后不受上述限制。删除存储位置不会递归删除内容；只有位置为空时
才允许删除，以避免误删数据。

```http
GET    /api/storage-locations
POST   /api/storage-locations
PATCH  /api/storage-locations/:id
DELETE /api/storage-locations/:id
```

新增和修改请求体：

```json
{
  "name": "团队空间",
  "anonymousAccess": "read"
}
```

文件列表、搜索、标签筛选、上传、创建文件夹和粘贴接口通过
`storageLocationId` 指定存储位置。未传时兼容使用默认 `TGFS`。

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

目录、标签筛选和全局搜索接口都支持分页及排序参数：

- `offset`：从第几条开始，默认 `0`；
- `limit`：每页数量，默认 `50`，最大 `100`；
- `sortBy`：`name`、`updatedAt` 或 `size`；
- `sortOrder`：`asc` 或 `desc`。

响应中会附带 `pagination`，包含 `offset`、`limit`、`total` 和
`hasMore`。例如：

```bash
curl 'http://localhost:3000/api/files?offset=0&limit=50&sortBy=updatedAt&sortOrder=desc'
```

### 全局搜索

全局搜索会按名称查询所有目录中的未删除文件和文件夹：

```bash
curl 'http://localhost:3000/api/files/search?q=报告&offset=0&limit=50&sortBy=name&sortOrder=asc'
```

搜索关键词不能为空，最长 100 个字符。

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

为保持真正的流式上传，multipart 请求中应按 `parentId`、可选
`thumbnail`、`file` 的顺序发送。`thumbnail` 必须是小于 200 KiB、最大边
不超过 320px 的 JPEG；原文件仍以 Stream 方式传输。上传根目录时可以省略
`parentId`。也可通过查询参数传递：

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
使用 Telegram 官方 Bot API 时，下载文件上限为 20 MiB。应用默认通过
`MAX_DOWNLOAD_SIZE=20971520` 在请求 Telegram 前拒绝超限文件，并返回
`DOWNLOAD_FILE_TOO_LARGE`，避免上游错误表现为 HTTP 500。

图片存在缩略图时，可通过以下接口以内联 JPEG 形式读取：

```bash
curl -o thumbnail.jpg http://localhost:3000/api/files/2/thumbnail
```

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
- 双击图片可在站内全屏预览，并可从预览窗口下载原图；
- 上传图片时由浏览器生成缩略图并随原文件保存到 Telegram，网格和列表视图
  会懒加载缩略图，加载失败时自动回退到文件图标；
- 匿名用户只能浏览、搜索、预览和下载；管理员登录后才能执行所有写操作；
- 支持拖拽框选、`⌘/Ctrl+点击` 多选和 `Shift+点击` 范围选择；
  `⌘/Ctrl+拖拽`可在原选区上追加项目；选择多个项目后，
  可把其中的文件以流式队列直接写入用户选择的本地目录，不经过浏览器下载管理器；
- 右键新建文件夹、复制、粘贴、上传，以及将单个或多个所选项目移到废纸篓；
- 在文件或文件夹右键菜单中设置 8 色标签，并通过侧边栏按标签筛选；
- `⌘C`、`⌘V`、`⇧⌘C`（复制下载链接）、`⇧⌘N`、`⌘U`
  快捷键；
- 把本地文件直接拖入页面上传到当前目录；
- 显示按文件大小加权的总上传进度，以及每个文件的等待、上传、
  Telegram 存储、完成和失败状态；
- 使用 macOS 风格的新建/删除对话框和统一 Toast 通知；
- 显示加载骨架、空目录、搜索无结果及加载失败重试状态；
- 底部显示可点击的真实目录面包屑路径；
- 目录、标签和全局搜索结果均按每页 50 条滚动加载；
- 支持按名称、修改日期或大小进行后端排序；
- 使用 300ms 防抖的后端全局名称搜索。

## 开发命令

```bash
npm run typecheck
npm test
npm run build
```

Prisma Schema 位于 `prisma/schema.prisma`，初始迁移位于
`prisma/migrations/20260727000000_init/`。
