import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { FileService } from "../src/modules/file/file.service.js";

const fileService = {
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
  downloadFile: vi.fn(async () => ({
    stream: Readable.from(["content"]),
    filename: "中文 文件.txt",
    mimeType: "text/plain",
    size: 7n,
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
  setFileTags: vi.fn(async () => ({
    id: "2",
    parentId: null,
    name: "tagged.txt",
    type: "file",
    size: "4",
    mimeType: "text/plain",
    extension: "txt",
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
    });

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<title>TGFS 文件管理器</title>");
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
    expect(response.body).not.toContain("alert(");
    expect(response.body).not.toContain("confirm(");
  });

  it("页面使用的文件列表接口正常响应", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
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
    expect(fileService.listFiles).toHaveBeenCalledWith(null, {
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
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files/search?q=%E6%8A%A5%E5%91%8A&limit=20&sortBy=updatedAt&sortOrder=desc",
    });

    expect(response.statusCode).toBe(200);
    expect(fileService.searchFiles).toHaveBeenCalledWith("报告", {
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
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/files?limit=101",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_PAGINATION");
  });

  it("提供前端粘贴操作使用的复制接口", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/files/1/copy",
      payload: { parentId: null },
    });

    expect(response.statusCode).toBe(201);
    expect(fileService.copyFile).toHaveBeenCalledWith(1n, null);
    expect(response.json().data.name).toBe("copy.txt");
  });

  it("提供标签列表和文件标签设置接口", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
    });

    const tagsResponse = await app.inject({
      method: "GET",
      url: "/api/tags",
    });
    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/files/2/tags",
      payload: { tags: ["red"] },
    });

    expect(tagsResponse.statusCode).toBe(200);
    expect(tagsResponse.json().data[0].slug).toBe("red");
    expect(updateResponse.statusCode).toBe(200);
    expect(fileService.setFileTags).toHaveBeenCalledWith(2n, [
      "red",
    ]);
  });

  it("使用安全响应头下载中文文件名", async () => {
    app = await buildApp({
      fileService,
      maxUploadSize: 1024,
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
});
