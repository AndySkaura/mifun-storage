# 米饭云盘

米饭云盘-小文件tg存储系统：

- SQLite 或 MySQL 仅保存目录、文件元数据和 Telegram 映射；
- 文件二进制只存储在 Telegram Channel；
- 上传和下载均使用 Node.js Stream，不写本地临时文件；
- 不包含用户、权限、分享、去重系统。

## 环境要求

- Node.js 20+
- 一个 Telegram Bot
- 一个用于存储文件的 Telegram Channel

默认使用内置 SQLite，无需安装数据库。需要连接已有数据库时支持
MySQL 8.x。

把 Bot 加入 Channel 并授予“发布消息”权限。Channel ID
通常形如 `-1001234567890`。

> **重要：Telegram Bot API 文件大小限制**
>
> 本项目默认使用 Telegram 官方 Bot API，因此单个文件的上传上限为
> **50 MiB**，下载上限为 **20 MiB**。这两个限制来自 Telegram Bot API，
> 不是本项目自身的存储限制。`MAX_UPLOAD_SIZE=52428800` 和
> `MAX_DOWNLOAD_SIZE=20971520` 默认与之保持一致；把环境变量设置得更大
> 也无法绕过 Telegram 官方接口限制，只建议根据实际需要调小。如需突破
> 上述大小限制，需要另外部署
> [Telegram Bot API Server](https://github.com/tdlib/telegram-bot-api)
> 并对本项目的 Telegram 接入方式进行相应适配；这会极大增加维护和硬件成本，
> 也并非本项目的设计初衷。

## 适用场景

本项目适合单实例、低并发、以大量小文件为主的长期存储和归档场景，例如：

- **照片持续上传与归档**：保存手机照片、截图、相册导出文件，并通过目录和
  标签进行整理；
- **日志存档**：定期上传应用日志、服务器日志、审计记录和压缩后的历史日志；
- **个人云盘**：存放文档、电子书、配置文件、代码片段和其他常用小文件；
- **自动化任务归档**：保存定时任务生成的报表、监控快照、构建产物和备份清单；
- **冷数据备份**：归档访问频率不高，但需要长期保留和随时下载的资料。

这里的“无限上传”是指利用 Telegram Channel 持续保存文件，不代表本项目
承诺真正无限的存储容量、可用性或服务等级。每个文件仍受 Telegram Bot API
的上传和下载大小限制，目录、标签及 Telegram 文件映射也依赖本地 SQLite
或 MySQL 元数据。

本项目不适合作为高并发网盘、多人协作平台、频繁随机读写的对象存储。

## 启动

```bash
cp .env.example .env
npm install
npm run dev
```

在 `.env` 中填写真实的 `TELEGRAM_BOT_TOKEN` 和
`TELEGRAM_STORAGE_CHAT_ID`。默认服务地址为
`http://localhost:3000`。未配置或留空 `DATABASE_URL` 时，数据库会自动
创建在 `data/mifun-storage.db`，首次启动会自动建表并初始化默认数据。

生产环境：

```bash
npm run build
npm start
```

如果配置了 MySQL，首次部署和 Schema 变更后仍需执行：

```bash
npm run prisma:deploy
```

## Docker 部署

Docker Hub 镜像地址：

```text
andyskaura/mifun-storage:latest
```

### 方案一：使用 Docker Compose（推荐）

先创建部署目录，并下载仓库提供的 Compose 文件和环境变量模板：

```bash
mkdir mifun-storage
cd mifun-storage
curl -O https://raw.githubusercontent.com/AndySkaura/mifun-storage/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/AndySkaura/mifun-storage/main/.env.example
```

编辑 `.env`，至少填写真实的 `TELEGRAM_BOT_TOKEN` 和
`TELEGRAM_STORAGE_CHAT_ID`。不使用外部 MySQL 时，保持
`DATABASE_URL` 未配置。

启动服务：

```bash
docker compose up -d
```

Compose 会自动拉取 `andyskaura/mifun-storage:latest`，通过 `.env` 注入
配置，将 SQLite 数据库持久化到 `mifun-storage_data` 命名卷，发布 `3000` 端口，
并在 Docker 或主机重启后恢复服务。

查看运行状态和日志：

```bash
docker compose ps
docker compose logs --tail=100 mifun-storage
docker compose logs -f mifun-storage
```

默认访问地址为 `http://localhost:3000`。停止或重新启动服务：

```bash
docker compose stop
docker compose start
docker compose restart
```

手动更新到 Docker Hub 最新版本：

```bash
docker compose pull
docker compose up -d
```

更新会重建应用容器，但不会删除 `mifun-storage_data` 中的 SQLite 数据。确认新版
运行正常后，可以清理不再使用的旧镜像：

```bash
docker image prune -f
```

如需每小时自动检查并更新镜像，启用可选的 Watchtower profile：

```bash
docker compose --profile auto-update up -d
```

Watchtower 需要挂载 Docker Socket，拥有较高的宿主机 Docker 管理权限，
因此只能用于可信镜像；不需要自动更新时不要启用该 profile。

删除容器和网络但保留 SQLite 数据：

```bash
docker compose down
```

不要运行 `docker compose down -v`，其中 `-v` 会删除 `mifun-storage_data` 数据卷。

### 方案二：直接使用 Docker 镜像

不使用 Compose 时，先准备 `.env`：

```bash
curl -o .env https://raw.githubusercontent.com/AndySkaura/mifun-storage/main/.env.example
```

填写 Telegram 配置后，直接拉取并运行 Docker Hub 镜像：

```bash
docker pull andyskaura/mifun-storage:latest
docker run -d \
  --name mifun-storage \
  --restart unless-stopped \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -v mifun_storage_data:/app/data \
  -p 3000:3000 \
  andyskaura/mifun-storage:latest
```

直接使用镜像时，后续更新需要拉取新镜像并重建容器：

```bash
docker pull andyskaura/mifun-storage:latest
docker stop mifun-storage
docker rm mifun-storage
docker run -d \
  --name mifun-storage \
  --restart unless-stopped \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -v mifun_storage_data:/app/data \
  -p 3000:3000 \
  andyskaura/mifun-storage:latest
```

`docker restart mifun-storage` 不会更新镜像，仅执行 `docker pull` 也不会替换正在运行
的容器。上述重建过程不会删除 `mifun-storage_data` 命名卷。

SQLite 仅适合运行一个应用实例；不要让多个容器共享同一个 SQLite 文件。
`mifun-storage_data` 卷需要纳入备份。

### 使用外部 MySQL

应用镜像不包含 MySQL。先在 `.env` 中把 `DATABASE_URL` 指向已有的
MySQL 8.x：

```env
DATABASE_URL=mysql://mifun-storage:password@mysql.example.com:3306/mifun-storage
TELEGRAM_BOT_TOKEN=1234567890:replace-with-real-token
TELEGRAM_STORAGE_CHAT_ID=-1001234567890
ADMIN_TOKEN=
MAX_UPLOAD_SIZE=52428800
MAX_DOWNLOAD_SIZE=20971520
```

构建迁移镜像并执行一次数据库迁移：

```bash
docker build --target migrate -t mifun-storage-migrate .
docker run --rm --env-file .env mifun-storage-migrate
```

然后运行 Docker Hub 上的应用镜像：

```bash
docker run -d \
  --name mifun-storage \
  --restart unless-stopped \
  --env-file .env \
  -e HOST=0.0.0.0 \
  -p 3000:3000 \
  andyskaura/mifun-storage:latest
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
保持云端存储的表现形式。迁移会创建默认的 `mifun-storage`，并把已有文件归入其中。
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
`storageLocationId` 指定存储位置。未传时兼容使用默认 `mifun-storage`。

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

默认最大文件大小为 **50 MiB**，对应 Telegram 官方 Bot API 的上传上限。
`MAX_UPLOAD_SIZE` 可以调小，但在继续使用官方 Bot API 时不要调大，调大也
无法绕过 Telegram 的限制。

### 下载文件

```bash
curl -OJ http://localhost:3000/api/files/2/download
```

服务从 Telegram 获取文件流并直接转发给 HTTP 客户端，不落盘。
使用 Telegram 官方 Bot API 时，下载文件上限为 **20 MiB**。应用默认通过
`MAX_DOWNLOAD_SIZE=20971520` 在请求 Telegram 前拒绝超限文件，并返回
`DOWNLOAD_FILE_TOO_LARGE`，避免上游错误表现为 HTTP 500。调大
`MAX_DOWNLOAD_SIZE` 无法突破 Telegram 官方接口的下载上限。

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
