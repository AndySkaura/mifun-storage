import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;

function createPage() {
  const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const htmlPreview = vi.fn();
  const imagePreview = vi.fn();
  const context = createContext({
    window: { matchMedia: () => ({ matches: false }), addEventListener: vi.fn() },
    document: {
      documentElement: { dataset: { theme: "light" } },
      createElement: () => link,
      body: { appendChild: vi.fn() },
    },
    URLSearchParams,
    htmlPreview,
    imagePreview,
  });
  runInContext(script, context);
  runInContext(`
    files = [{ id: '1', type: 'file', name: '页面.html', extension: 'html',
      mimeType: 'text/html', iconType: 'code', contentToken: 'html-token', tags: [] }];
    selectedFileId = '1';
    selectedFileIds = new Set(['1']);
    hideContextMenu = () => {};
    openHtmlPreview = htmlPreview;
    openImagePreview = imagePreview;
  `, context);
  return { context, link, htmlPreview, imagePreview };
}

describe("预览和下载入口", () => {
  it("双击 HTML 仍打开预览", async () => {
    const page = createPage();
    await runInContext("openFile('1')", page.context);
    expect(page.htmlPreview).toHaveBeenCalledOnce();
    expect(page.link.click).not.toHaveBeenCalled();
  });

  it("HTML 右键菜单的下载操作请求下载地址", () => {
    const page = createPage();
    runInContext("handleMenuAction('open')", page.context);
    expect(page.link.click).toHaveBeenCalledOnce();
    expect(page.link.href).toBe("/api/files/content/html-token/download");
    expect(page.link.download).toBe("页面.html");
    expect(page.htmlPreview).not.toHaveBeenCalled();
  });

  it.each(["html", "image"])("下载所选单个 %s 文件时直接下载", async (type) => {
    const page = createPage();
    if (type === "image") runInContext("files[0].iconType = 'image'", page.context);
    await runInContext("startSelectedDownloads()", page.context);
    expect(page.link.click).toHaveBeenCalledOnce();
    expect(page.htmlPreview).not.toHaveBeenCalled();
    expect(page.imagePreview).not.toHaveBeenCalled();
  });

  it("图片右键菜单仍可预览及下载原图", () => {
    const page = createPage();
    runInContext("files[0].name = '图片.png'; files[0].extension = 'png'; files[0].mimeType = 'image/png'; files[0].iconType = 'image'", page.context);
    runInContext("handleMenuAction('open')", page.context);
    expect(page.imagePreview).toHaveBeenCalledOnce();
    expect(page.link.click).not.toHaveBeenCalled();
    runInContext("handleMenuAction('download')", page.context);
    expect(page.link.click).toHaveBeenCalledOnce();
  });
});
