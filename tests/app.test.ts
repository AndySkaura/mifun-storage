import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { FileService } from "../src/modules/file/file.service.js";

const adminToken = "test-admin-token-with-at-least-32-characters";
const adminHeaders = {
  authorization: `Bearer ${adminToken}`,
};
const contentToken = "abcdefghijklmnopqrstuv";

const fileService = {
  requireStorageAccess: vi.fn(async () => undefined),
  listStorageLocations: vi.fn(async () => [
    { id: "1", name: "TGFS", anonymousAccess: "write" },
  ]),
  createStorageLocation: vi.fn(async (input) => ({
    id: "2",
    ...input,
  })),
  updateStorageLocation: vi.fn(async (input) => ({
    id: String(input.id),
    name: input.name,
    anonymousAccess: input.anonymousAccess,
  })),
  unlockStorageLocation: vi.fn(async () => "storage-access-token"),
  deleteStorageLocation: vi.fn(async () => undefined),
  getFile: vi.fn(async () => ({
    id: "2",
    storageLocationId: "1",
    parentId: null,
    name: "测试项目",
    type: "file",
    size: "4",
    mimeType: "text/plain",
    extension: "txt",
    contentToken,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    hasThumbnail: false,
    tags: [],
  })),
  createFolder: vi.fn(async () => ({
    id: "4",
    parentId: null,
    name: "匿名文件夹",
    type: "folder",
    size: "0",
    mimeType: null,
    extension: null,
    contentToken: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    hasThumbnail: false,
    tags: [],
  })),
  listFiles: vi.fn(async () => ({
    data: [],
    pagination: {
      offset: 0,
      limit: 50,
      total: 0,
      hasMore: false,
    },
  })),
  searchFiles: vi.fn(async () => ({
    data: [],
    pagination: {
      offset: 0,
      limit: 20,
      total: 0,
      hasMore: false,
    },
  })),
  copyFile: vi.fn(async () => ({
    id: "2",
    parentId: null,
    name: "copy.txt",
    type: "file",
    size: "4",
    mimeType: "text/plain",
    extension: "txt",
    contentToken,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    tags: [],
  })),
  uploadFile: vi.fn(async (input: { stream: Readable }) => {
    for await (const _chunk of input.stream) {
      // 测试桩消费上传流，保持真实服务的背压行为。
    }
    return {
      id: "3",
      parentId: null,
      name: "photo.jpg",
      type: "file",
      size: "5",
      mimeType: "image/jpeg",
      extension: "jpg",
      contentToken,
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      hasThumbnail: true,
      tags: [],
    };
  }),
  downloadFileByContentToken: vi.fn(async () => ({
    stream: Readable.from(["content"]),
    filename: "中文 文件.txt",
    mimeType: "text/plain",
    size: 7n,
  })),
  downloadThumbnailByContentToken: vi.fn(async () => ({
    stream: Readable.from(["thumbnail"]),
    filename: "photo.jpg.thumbnail.jpg",
    mimeType: "image/jpeg",
    size: 9n,
  })),
  createPrivateContentLinks: vi.fn(async () => [
    {
      fileId: "2",
      token: "privateabcdefghijklmno",
    },
  ]),
  downloadPrivateContent: vi.fn(async () => ({
    stream: Readable.from(["private-content"]),
    filename: "private.png",
    mimeType: "image/png",
    size: 15n,
  })),
  listTags: vi.fn(async () => [
    { slug: "red", name: "红色", color: "#ef4444" },
  ]),
  listFilesByTag: vi.fn(async () => ({
    data: [],
    pagination: {
      offset: 0,
      limit: 50,
      total: 0,
      hasMore: false,
    },
  })),
  deleteFile: vi.fn(async () => undefined),
  setFileTags: vi.fn(async () => ({
    id: "2",
    parentId: null,
    name: "设计资料",
    type: "folder",
    size: "0",
    mimeType: null,
    extension: null,
    contentToken: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    tags: [{ slug: "red", name: "红色", color: "#ef4444" }],
  })),
} as unknown as FileService;

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("HTTP 应用", () => {
  it("提供独立统计页面与缓存统计接口", async () => {
    const statisticsService = {
      getStatistics: vi.fn(async () => ({
        data: {
          totalItems: 3,
          totalFiles: 2,
          totalFolders: 1,
          totalBytes: "1024",
          storageLocations: 1,
          extensionDistribution: [{ label: "webp", count: 2 }],
          folderFileMatrix: [
            {
              id: "2",
              name: "素***材",
              label: "素***材",
              fileCount: 2,
            },
          ],
          monthlyGrowth: [],
          lastItemId: "3",
          recentActivity: [
            {
              id: "3",
              name: "设***稿.webp",
              label: "+webp",
              type: "file",
              extension: "webp",
              size: "1024",
              createdAt: "2026-08-04T00:00:00.000Z",
              path: "素***材/设***稿.webp",
              folderIds: ["2"],
            },
          ],
        },
        cache: {
          hit: true,
          generatedAt: "2026-08-04T00:00:00.000Z",
          expiresAt: "2026-08-04T00:15:00.000Z",
        },
      })),
      getActivity: vi.fn(async () => ({
        data: [
          {
            id: "4",
            name: "新文***夹",
            label: "+文件夹",
            type: "folder",
            extension: null,
            size: "0",
            createdAt: "2026-08-04T00:01:00.000Z",
            path: "新文***夹",
            folderIds: [],
          },
        ],
        cursor: "4",
      })),
    };
    app = await buildApp({
      fileService,
      statisticsService: statisticsService as never,
      maxUploadSize: 1024,
      adminToken,
      siteUrl: "https://storage.example.com",
    });

    const page = await app.inject({ method: "GET", url: "/about" });
    const robots = await app.inject({ method: "GET", url: "/robots.txt" });
    const sitemap = await app.inject({ method: "GET", url: "/sitemap.xml" });
    const api = await app.inject({
      method: "GET",
      url: "/api/statistics",
    });
    const activity = await app.inject({
      method: "GET",
      url: "/api/statistics/activity?after=3",
    });
    const invalidActivityLimit = await app.inject({
      method: "GET",
      url: "/api/statistics/activity?after=3&limit=201",
    });

    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain(
      "<title>文件存储统计与格式分析 · 米饭云盘</title>",
    );
    expect(page.body).toContain(
      '<link rel="canonical" href="https://storage.example.com/about">',
    );
    expect(page.body).toContain('property="og:title"');
    expect(page.body).toContain('type="application/ld+json"');
    expect(page.body).toContain('href="https://kuraa.cc"');
    expect(page.body).toContain(
      'href="https://github.com/AndySkaura/mifun-storage"',
    );
    expect(page.body).not.toContain("__SEO_");
    expect(page.body).toContain("emitActivityParticles");
    expect(page.body).toContain("/vendor/echarts.min.js");
    expect(page.body).toContain("/api/statistics/activity");
    expect(page.body).toContain("历史新增");
    expect(page.body).toContain("folderFileMatrix");
    expect(page.body).toContain("matrixRows");
    expect(page.body).toContain("animateTotalNumber");
    expect(page.body).toContain("digit-wheel");
    expect(page.body).toContain("start === end");
    expect(page.body).toContain("wheel.dataset.rolling");
    expect(page.body).toContain("catchUpActivity");
    expect(page.body).toContain("requestActivity(catchUpLimit)");
    expect(page.body).not.toContain(
      "emitActivityParticles(data.recentActivity",
    );
    expect(page.body).not.toContain(
      '<div class="panel-title">最近新增</div>',
    );
    expect(api.statusCode).toBe(200);
    expect(api.json().data.totalItems).toBe(3);
    expect(api.json().cache.hit).toBe(true);
    expect(activity.statusCode).toBe(200);
    expect(activity.json().data[0].label).toBe("+文件夹");
    expect(invalidActivityLimit.statusCode).toBe(400);
    expect(invalidActivityLimit.json().error.code).toBe(
      "INVALID_ACTIVITY_LIMIT",
    );
    expect(statisticsService.getStatistics).toHaveBeenCalledWith(false);
    expect(statisticsService.getActivity).toHaveBeenCalledWith(
      3n,
      20,
      false,
    );
    expect(robots.body).toContain(
      "Sitemap: https://storage.example.com/sitemap.xml",
    );
    expect(sitemap.body).toContain(
      "<loc>https://storage.example.com/about</loc>",
    );
  });

  it("关闭统计功能后不开放页面和统计 API", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
      siteUrl: "https://storage.example.com",
      aboutEnabled: false,
    });

    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/about" }),
      app.inject({ method: "GET", url: "/about.html" }),
      app.inject({ method: "GET", url: "/api/statistics" }),
      app.inject({
        method: "GET",
        url: "/api/statistics/activity?after=0",
      }),
    ]);
    const status = await app.inject({
      method: "GET",
      url: "/api/admin/status",
    });
    const sitemap = await app.inject({
      method: "GET",
      url: "/sitemap.xml",
    });

    expect(responses.map((response) => response.statusCode)).toEqual([
      404, 404, 404, 404,
    ]);
    expect(status.json().data.aboutEnabled).toBe(false);
    expect(sitemap.body).not.toContain("/about");
  });

  it("从根路径提供文件管理页面", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(
      "<title>米饭云盘-小文件tg存储系统</title>",
    );
    expect(response.body).toContain('href="/about"');
    expect(response.body).toContain('id="statistics-link"');
    expect(response.body).toContain("body.data.aboutEnabled === false");
    expect(response.body).toContain("#statistics-link,\n      #btn-admin-auth");
    expect(response.body).toContain(
      "button.innerText = adminToken ? '退出' : '管理员'",
    );
    expect(response.body).toContain("复制链接");
    expect(response.body).toContain('id="public-link-dialog"');
    expect(response.body).toContain('id="storage-unlock-dialog"');
    expect(response.body).toContain('id="storage-password-input"');
    expect(response.body).toContain(
      "tgfs-skip-hidden-public-link-warning",
    );
    expect(response.body).toContain(
      "publicContentUrl(file, isImage ? 'preview' : 'download')",
    );
    expect(response.body).toContain("/private-content/");
    expect(response.body).toContain("上传任务");
    expect(response.body).toContain("XMLHttpRequest");
    expect(response.body).toContain("未命名文件夹");
    expect(response.body).not.toContain("prompt('请输入文件夹名称')");
    expect(response.body).toContain("移到废纸篓？");
    expect(response.body).toContain("toast-container");
    expect(response.body).toContain("此文件夹为空");
    expect(response.body).toContain('id="sort-select"');
    expect(response.body).toContain("performGlobalSearch");
    expect(response.body).toContain("handleInfiniteScroll");
    expect(response.body).toContain('id="selection-marquee"');
    expect(response.body).toContain("const bytes = Number(value)");
    expect(response.body).toContain("formatFileType(file)");
    expect(response.body).toContain('class="file-list-columns');
    expect(response.body).not.toContain("w-1/8");
    expect(response.body).toContain("context-tag-button");
    expect(response.body).not.toContain("disabled:opacity-35");
    expect(response.body).toContain("beginMarqueeSelection");
    expect(response.body).toContain('title="${escapeHtml(file.name)}"');
    expect(response.body).toContain("再次点击“${selected.name}”可打开");
    expect(response.body).toContain("mobile-row-action");
    expect(response.body).toContain("hideContextMenuOnViewportChange");
    expect(response.body).toContain('id="image-preview-dialog"');
    expect(response.body).toContain('id="image-preview-toolbar"');
    expect(response.body).toContain('id="btn-image-preview-previous"');
    expect(response.body).toContain('id="btn-image-preview-next"');
    expect(response.body).toContain("changePreviewImage(-1)");
    expect(response.body).toContain("changePreviewImage(1)");
    expect(response.body).toContain("event.key === 'ArrowLeft'");
    expect(response.body).toContain("event.key === 'ArrowRight'");
    expect(response.body).toContain('handleImagePreviewTouchEnd');
    expect(response.body).toContain("env(safe-area-inset-top)");
    expect(response.body).toContain("height: 100dvh");
    expect(response.body).toContain("openImagePreview");
    expect(response.body).toContain('data-menu-action="refresh"');
    expect(response.body).toContain("if (action === 'refresh') refreshContent()");
    expect(response.body).not.toContain("?animation=${Date.now()}");
    expect(response.body).toContain("pendingDeleteItems");
    expect(response.body).toContain('id="delete-dialog-message"');
    expect(response.body).toContain('id="admin-dialog"');
    expect(response.body).toContain("requireAdmin");
    expect(response.body).toContain("/api/storage-locations");
    expect(response.body).toContain("method: 'PATCH'");
    expect(response.body).not.toContain(
      "apiRequest(`/storage-locations/",
    );
    expect(response.body).not.toContain("alert(");
    expect(response.body).not.toContain("confirm(");
  });

  it("页面使用的文件列表接口正常响应", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: [],
      pagination: {
        offset: 0,
        limit: 50,
        total: 0,
        hasMore: false,
      },
    });
    expect(fileService.listFiles).toHaveBeenCalledWith(1n, null, {
      offset: 0,
      limit: 50,
      sortBy: "name",
      sortOrder: "asc",
    });
  });

  it("提供带分页和排序的后端全局搜索接口", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files/search?q=%E6%8A%A5%E5%91%8A&limit=20&sortBy=updatedAt&sortOrder=desc",
    });

    expect(response.statusCode).toBe(200);
    expect(fileService.searchFiles).toHaveBeenCalledWith(1n, "报告", {
      offset: 0,
      limit: 20,
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    expect(response.json().pagination.hasMore).toBe(false);
  });

  it("拒绝超过上限的分页数量", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files?limit=101",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_PAGINATION");
  });

  it("管理员验证接口仍要求携带管理员 Token", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/admin/verify",
    });
    const authorized = await app.inject({
      method: "POST",
      url: "/api/admin/verify",
      headers: adminHeaders,
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/admin/status",
    });
    const anonymousDelete = await app.inject({
      method: "DELETE",
      url: "/api/files/2",
    });
    const anonymousTagUpdate = await app.inject({
      method: "PUT",
      url: "/api/files/2/tags",
      payload: { tags: ["red"] },
    });
    const anonymousStorageUnlock = await app.inject({
      method: "POST",
      url: "/api/storage-locations/2/unlock",
      payload: { password: "rice-1234" },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe(
      "ADMIN_AUTH_REQUIRED",
    );
    expect(unauthorized.headers["www-authenticate"]).toBe("Bearer");
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().data.authenticated).toBe(true);
    expect(status.json().data.required).toBe(true);
    expect(anonymousDelete.statusCode).toBe(401);
    expect(anonymousTagUpdate.statusCode).toBe(200);
    expect(anonymousStorageUnlock.statusCode).toBe(200);
    expect(anonymousStorageUnlock.json().data.token).toBe(
      "storage-access-token",
    );
    expect(fileService.setFileTags).toHaveBeenLastCalledWith(
      2n,
      ["red"],
      false,
      {},
      false,
    );
  });

  it("只有管理员可以新增存储位置", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const payload = {
      name: "团队空间",
      anonymousAccess: "read",
    };
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/storage-locations",
      payload,
    });
    const admin = await app.inject({
      method: "POST",
      url: "/api/storage-locations",
      headers: adminHeaders,
      payload,
    });

    expect(anonymous.statusCode).toBe(401);
    expect(admin.statusCode).toBe(201);
    expect(fileService.createStorageLocation).toHaveBeenCalledWith(
      payload,
    );
  });

  it("管理员 Token 为空时允许匿名执行全部操作", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken: "",
    });

    const status = await app.inject({
      method: "GET",
      url: "/api/admin/status",
    });
    const tagUpdate = await app.inject({
      method: "PUT",
      url: "/api/files/2/tags",
      payload: { tags: ["red"] },
    });
    const deletion = await app.inject({
      method: "DELETE",
      url: "/api/files/2",
    });
    const verification = await app.inject({
      method: "POST",
      url: "/api/admin/verify",
    });
    expect(status.json().data.required).toBe(false);
    expect(tagUpdate.statusCode).toBe(200);
    expect(deletion.statusCode).toBe(204);
    expect(verification.statusCode).toBe(200);
  });

  it("提供前端粘贴操作使用的复制接口", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/files/1/copy",
      payload: { parentId: null },
    });

    expect(response.statusCode).toBe(201);
    expect(fileService.copyFile).toHaveBeenCalledWith(1n, 1n, null);
    expect(response.json().data.name).toBe("copy.txt");
  });

  it("允许匿名创建文件夹", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/files/folder",
      payload: { name: "匿名文件夹", parentId: null },
    });

    expect(response.statusCode).toBe(201);
    expect(fileService.createFolder).toHaveBeenCalledWith({
      name: "匿名文件夹",
      storageLocationId: 1n,
      parentId: null,
    });
  });

  it("提供标签列表并允许为文件夹设置标签", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const tagsResponse = await app.inject({
      method: "GET",
      url: "/api/tags",
    });
    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/files/2/tags",
      headers: adminHeaders,
      payload: { tags: ["red"] },
    });

    expect(tagsResponse.statusCode).toBe(200);
    expect(tagsResponse.json().data[0].slug).toBe("red");
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().data.type).toBe("folder");
    expect(fileService.setFileTags).toHaveBeenCalledWith(
      2n,
      ["red"],
      true,
      {},
      true,
    );
  });

  it("上传图片时接收位于原文件之前的 JPEG 缩略图", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });
    const boundary = "----tgfs-thumbnail-test";
    const payload = Buffer.from([
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="parentId"\r\n\r\n',
      "1\r\n",
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="thumbnail"; filename="thumbnail.jpg"\r\n',
      "Content-Type: image/jpeg\r\n\r\n",
      "jpeg-data\r\n",
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="file"; filename="photo.jpg"\r\n',
      "Content-Type: image/jpeg\r\n\r\n",
      "image-data\r\n",
      `--${boundary}--\r\n`,
    ].join(""));

    const response = await app.inject({
      method: "POST",
      url: "/api/files/upload",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const input = vi.mocked(fileService.uploadFile).mock.calls.at(-1)?.[0];
    expect(input).toMatchObject({
      storageLocationId: 1n,
      parentId: 1n,
      filename: "photo.jpg",
      mimeType: "image/jpeg",
    });
    expect(input?.thumbnail?.toString()).toBe("jpeg-data");
  });

  it("使用安全响应头下载中文文件名", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/files/content/${contentToken}/download`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("content");
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.txt",
    );
    expect(response.headers["content-disposition"]).toMatch(
      /^[\x20-\x7e]+$/,
    );
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("不再提供可枚举的数字 ID 内容地址", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files/2/download",
    });

    expect(response.statusCode).toBe(404);
  });

  it("管理员可签发不缓存的私有内容链接", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/api/files/private-content-links",
      payload: { fileIds: ["2"] },
    });
    expect(unauthorized.statusCode).toBe(401);

    const created = await app.inject({
      method: "POST",
      url: "/api/files/private-content-links",
      headers: adminHeaders,
      payload: { fileIds: ["2"] },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data[0].token).toBe(
      "privateabcdefghijklmno",
    );

    const deniedContent = await app.inject({
      method: "GET",
      url: "/api/files/private-content/privateabcdefghijklmno?m=p",
    });
    expect(deniedContent.statusCode).toBe(401);
    expect(deniedContent.headers["www-authenticate"]).toBe("Bearer");

    const invalidBearerContent = await app.inject({
      method: "GET",
      url: "/api/files/private-content/privateabcdefghijklmno?m=p",
      headers: { authorization: "Bearer invalid-token" },
    });
    expect(invalidBearerContent.statusCode).toBe(401);

    const content = await app.inject({
      method: "GET",
      url: "/api/files/private-content/privateabcdefghijklmno?m=p",
      headers: adminHeaders,
    });
    expect(content.statusCode).toBe(200);
    expect(content.body).toBe("private-content");
    expect(content.headers["cache-control"]).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(
      content.headers["cloudflare-cdn-cache-control"],
    ).toBe("no-store");
    expect(content.headers.vary).toBe("Authorization");
  });

  it("以内联响应提供图片预览", async () => {
    vi.mocked(fileService.downloadFileByContentToken).mockResolvedValueOnce({
      stream: Readable.from(["image-content"]),
      filename: "预览 图片.png",
      mimeType: "image/png",
      size: 13n,
    });
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/files/content/${contentToken}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("image-content");
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["content-disposition"]).toMatch(/^inline;/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("根据扩展名以内联 GIF 类型提供动图预览", async () => {
    vi.mocked(fileService.downloadFileByContentToken).mockResolvedValueOnce({
      stream: Readable.from(["gif-content"]),
      filename: "动图.gif",
      mimeType: "application/octet-stream",
      size: 11n,
    });
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/files/content/${contentToken}/preview`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("gif-content");
    expect(response.headers["content-type"]).toContain("image/gif");
    expect(response.headers["content-disposition"]).toMatch(/^inline;/);
  });

  it("提供可缓存的图片缩略图", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/files/content/${contentToken}/thumbnail`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("thumbnail");
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(
      fileService.downloadThumbnailByContentToken,
    ).toHaveBeenCalledWith(contentToken);
  });

  it("拒绝预览非图片文件", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/files/content/${contentToken}/preview`,
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("FILE_NOT_PREVIEWABLE");
  });
});
