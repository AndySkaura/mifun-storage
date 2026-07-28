import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { FileService } from "../src/modules/file/file.service.js";

const adminToken = "test-admin-token-with-at-least-32-characters";
const adminHeaders = {
  authorization: `Bearer ${adminToken}`,
};

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
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      hasThumbnail: true,
      tags: [],
    };
  }),
  downloadFile: vi.fn(async () => ({
    stream: Readable.from(["content"]),
    filename: "中文 文件.txt",
    mimeType: "text/plain",
    size: 7n,
  })),
  downloadThumbnail: vi.fn(async () => ({
    stream: Readable.from(["thumbnail"]),
    filename: "photo.jpg.thumbnail.jpg",
    mimeType: "image/jpeg",
    size: 9n,
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
    expect(response.body).toContain("复制链接");
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
    expect(response.body).toContain('id="image-preview-dialog"');
    expect(response.body).toContain('id="image-preview-toolbar"');
    expect(response.body).toContain("env(safe-area-inset-top)");
    expect(response.body).toContain("height: 100dvh");
    expect(response.body).toContain("openImagePreview");
    expect(response.body).toContain('data-menu-action="refresh"');
    expect(response.body).toContain("if (action === 'refresh') refreshContent()");
    expect(response.body).toContain("?animation=${Date.now()}");
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
    expect(fileService.setFileTags).toHaveBeenLastCalledWith(
      2n,
      ["red"],
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
      url: "/api/files/2/download",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("content");
    expect(response.headers["content-disposition"]).toContain(
      "filename*=UTF-8''%E4%B8%AD%E6%96%87%20%E6%96%87%E4%BB%B6.txt",
    );
    expect(response.headers["content-disposition"]).toMatch(
      /^[\x20-\x7e]+$/,
    );
  });

  it("以内联响应提供图片预览", async () => {
    vi.mocked(fileService.downloadFile).mockResolvedValueOnce({
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
      url: "/api/files/2/preview",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("image-content");
    expect(response.headers["content-type"]).toContain("image/png");
    expect(response.headers["content-disposition"]).toMatch(/^inline;/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("根据扩展名以内联 GIF 类型提供动图预览", async () => {
    vi.mocked(fileService.downloadFile).mockResolvedValueOnce({
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
      url: "/api/files/2/preview",
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
      url: "/api/files/3/thumbnail",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("thumbnail");
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["cache-control"]).toBe(
      "private, max-age=86400",
    );
    expect(fileService.downloadThumbnail).toHaveBeenCalledWith(3n);
  });

  it("拒绝预览非图片文件", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
      adminToken,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files/2/preview",
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("FILE_NOT_PREVIEWABLE");
  });
});
