import type { FastifyPluginAsync } from "fastify";
import type { FileController } from "./file.controller.js";

export function createFileRoutes(
  controller: FileController,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/folder", controller.createFolder);
    app.get("/", controller.listFiles);
    app.get("/search", controller.searchFiles);
    app.get("/by-tag/:slug", controller.listFilesByTag);
    app.get("/:id", controller.getFile);
    app.put("/:id/tags", controller.setFileTags);
    app.post("/upload", controller.uploadFile);
    app.post("/:id/copy", controller.copyFile);
    app.get("/content/:token/thumbnail", controller.thumbnailImage);
    app.get("/content/:token/preview", controller.previewImage);
    app.get("/content/:token/download", controller.downloadFile);
    app.delete("/:id", controller.deleteFile);
  };
}
