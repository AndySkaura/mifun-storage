import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;

function createPage() {
  const container = { scrollTop: 1200, getBoundingClientRect: () => ({ top: 100 }) };
  const targetElement = { dataset: { fileId: "502" }, getBoundingClientRect: () => ({ top: 800 }) };
  const api = vi.fn(async () => ({ data: { index: 351 } }));
  const loadWindow = vi.fn(async () => true);
  const selection = vi.fn();
  const savePosition = vi.fn();
  const refresh = vi.fn();
  const toast = vi.fn();
  const context = createContext({
    window: { matchMedia: () => ({ matches: false }), addEventListener: vi.fn() },
    document: {
      documentElement: { dataset: { theme: "light" } },
      getElementById: (id: string) => id === "content-area" ? container : null,
      querySelectorAll: () => [targetElement],
    },
    URLSearchParams,
    requestAnimationFrame: (callback: () => void) => queueMicrotask(callback),
    api, loadWindow, selection, savePosition, refresh, toast,
  });
  runInContext(script, context);
  runInContext(`
    currentStorageLocationId = '1';
    files = [{ id: '501' }, { id: '502' }, { id: '503' }];
    apiRequest = api;
    loadDirectoryWindow = loadWindow;
    updateSelectionUi = selection;
    saveCurrentDirectoryPosition = savePosition;
    loadFiles = refresh;
    showToast = toast;
  `, context);
  return { context, container, api, loadWindow, selection, savePosition, refresh, toast };
}

const completed = ["501", "502"].map(id => ({
  targetStorageLocationId: "1",
  targetParentId: null,
  uploadedFile: { id, storageLocationId: "1" },
}));

describe("上传后定位", () => {
  it("加载跨页目标并高亮本批文件，定位最后一个成功文件", async () => {
    const page = createPage();
    page.context.completed = completed;
    await runInContext("revealUploadedFiles(completed)", page.context);
    expect(page.api).toHaveBeenCalledWith("/502/position?sortBy=updatedAt&sortOrder=desc");
    expect(page.loadWindow).toHaveBeenCalledWith(7, { force: true });
    expect(runInContext("[...selectedFileIds]", page.context)).toEqual(["501", "502"]);
    expect(runInContext("selectedFileId", page.context)).toBe("502");
    expect(page.container.scrollTop).toBe(1884);
    expect(page.savePosition).toHaveBeenCalledOnce();
  });

  it("用户切换目录后忽略尚未返回的定位请求", async () => {
    const page = createPage();
    let resolve!: (value: { data: { index: number } }) => void;
    page.api.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    page.context.completed = completed;
    const revealing = runInContext("revealUploadedFiles(completed)", page.context);
    runInContext("navigationHistory.push({ id: '9' }); historyIndex++; viewRequestId++;", page.context);
    resolve({ data: { index: 351 } });
    await revealing;
    expect(page.loadWindow).not.toHaveBeenCalled();
    expect(page.selection).not.toHaveBeenCalled();
    expect(page.container.scrollTop).toBe(1200);
  });

  it("上传目标不在当前目录时只清缓存，保留当前视图", async () => {
    const page = createPage();
    page.context.completed = completed;
    runInContext(`
      currentDirectoryState().pages.set(0, [{ id: 'old' }]);
      navigationHistory.push({ id: '9' }); historyIndex++;
    `, page.context);
    await runInContext("revealUploadedFiles(completed)", page.context);
    expect(runInContext("navigationHistory[0].directoryState.pages.size", page.context)).toBe(0);
    expect(page.api).not.toHaveBeenCalled();
    expect(page.refresh).not.toHaveBeenCalled();
  });

  it("定位失败时提示并刷新目录，不将成功上传改成失败", async () => {
    const page = createPage();
    page.api.mockRejectedValueOnce(new Error("定位请求失败"));
    page.context.completed = completed;
    await runInContext("revealUploadedFiles(completed)", page.context);
    expect(page.toast).toHaveBeenCalledWith("文件已上传，但自动定位失败：定位请求失败", "info");
    expect(page.refresh).toHaveBeenCalledOnce();
  });

  it("底部文件被上传面板遮挡时补充滚动空间", () => {
    const page = createPage();
    const spacer = { dataset: {}, style: { height: "" }, setAttribute: vi.fn() };
    const container = Object.assign(page.container, {
      scrollTop: 400, scrollHeight: 1000, clientHeight: 600, appendChild: vi.fn(),
    });
    const panel = {
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ left: 8, right: 382, top: 560, bottom: 836 }),
    };
    page.context.document.getElementById = () => panel;
    page.context.document.createElement = () => spacer;
    Object.assign(page.context, {
      container,
      element: { getBoundingClientRect: () => ({ left: 8, right: 380, top: 700, bottom: 752 }) },
    });
    runInContext("keepUploadedFileVisible(element, container)", page.context);
    expect(container.appendChild).toHaveBeenCalledWith(spacer);
    expect(spacer.style.height).toBe("208px");
    expect(container.scrollTop).toBe(608);
  });

  it("队列只定位成功上传的项目，并保留上传接口返回的文件 ID", async () => {
    const page = createPage();
    const uploaded = vi.fn()
      .mockResolvedValueOnce({ data: { id: "501", storageLocationId: "1" } })
      .mockRejectedValueOnce(new Error("网络失败"));
    const reveal = vi.fn();
    Object.assign(page.context, { uploaded, reveal });
    runInContext(`
      renderUploadProgress = () => {};
      setStatus = () => {};
      createImageThumbnail = async () => null;
      uploadOneWithProgress = uploaded;
      revealUploadedFiles = reveal;
      uploadQueue = ['成功.txt', '失败.txt'].map(name => ({
        name, file: {}, status: 'pending', targetStorageLocationId: '1', targetParentId: null
      }));
    `, page.context);
    await runInContext("processUploadQueue()", page.context);
    expect(runInContext("uploadQueue.map(item => item.status)", page.context))
      .toEqual(["completed", "failed"]);
    expect(reveal).toHaveBeenCalledWith([
      expect.objectContaining({ uploadedFile: { id: "501", storageLocationId: "1" }, status: "completed" }),
    ]);
  });
});
