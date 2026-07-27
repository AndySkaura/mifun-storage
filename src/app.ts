import multipart from "@fastify/multipart";
import { Prisma } from "@prisma/client";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
} from "fastify";
import { FileController } from "./modules/file/file.controller.js";
import { createFileRoutes } from "./modules/file/file.route.js";
import type { FileService } from "./modules/file/file.service.js";
import { isAppError } from "./utils/app-error.js";

export interface BuildAppOptions {
  fileService: FileService;
  maxUploadSize: number;
  logger?: boolean | FastifyBaseLogger;
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: options.maxUploadSize,
      fields: 10,
    },
    throwFileSizeLimit: true,
  });

  const controller = new FileController(options.fileService);
  await app.register(createFileRoutes(controller), {
    prefix: "/api/files",
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "接口不存在",
      },
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (isAppError(error)) {
      await reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      await reply.code(404).send({
        error: { code: "FILE_NOT_FOUND", message: "文件不存在" },
      });
      return;
    }

    const standardError =
      typeof error === "object" && error !== null ? error : {};
    const candidateStatus =
      "statusCode" in standardError
        ? standardError.statusCode
        : undefined;
    const statusCode =
      typeof candidateStatus === "number" &&
      candidateStatus >= 400 &&
      candidateStatus < 500
        ? candidateStatus
        : 500;

    if (statusCode === 500) {
      request.log.error(error);
    }

    await reply.code(statusCode).send({
      error: {
        code:
          statusCode === 413
            ? "FILE_TOO_LARGE"
            : statusCode === 500
              ? "INTERNAL_ERROR"
              : "BAD_REQUEST",
        message:
          statusCode === 413
            ? "上传文件超过允许的大小"
            : statusCode === 500
              ? "服务器内部错误"
              : "message" in standardError &&
                  typeof standardError.message === "string"
                ? standardError.message
                : "请求无效",
      },
    });
  });

  return app;
}
