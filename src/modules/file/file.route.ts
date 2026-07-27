import type { FastifyPluginAsync } from "fastify";
import type { FileController } from "./file.controller.js";

export function createFileRoutes(
  controller: FileController,
): FastifyPluginAsync {
  return async (app) => {
    app.post("/folder", controller.createFolder);
    app.get("/", controller.listFiles);
    app.get("/:id", controller.getFile);
    app.post("/upload", controller.uploadFile);
    app.get("/:id/download", controller.downloadFile);
    app.delete("/:id", controller.deleteFile);
  };
}
