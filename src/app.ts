import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { Prisma } from "@prisma/client";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
} from "fastify";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { FileController } from "./modules/file/file.controller.js";
import { createFileRoutes } from "./modules/file/file.route.js";
import type { FileService } from "./modules/file/file.service.js";
import type { StatisticsService } from "./modules/statistics/statistics.service.js";
import { AppError, isAppError } from "./utils/app-error.js";

export interface BuildAppOptions {
  fileService: FileService;
  maxUploadSize: number;
  adminToken: string;
  statisticsService?: StatisticsService;
  logger?: boolean | FastifyBaseLogger;
}

export async function buildApp(
  options: BuildAppOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  app.addHook("onRequest", async (request, reply) => {
    if (
      !options.adminToken ||
      !request.url.startsWith("/api/") ||
      ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
      isAnonymousWriteRequest(request.method, request.url)
    ) {
      return;
    }

    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (
      !match ||
      !secureTokenEquals(match[1]!, options.adminToken)
    ) {
      reply.header("www-authenticate", "Bearer");
      throw new AppError(
        401,
        "ADMIN_AUTH_REQUIRED",
        "需要管理员 Token 才能执行此操作",
      );
    }
  });

  await app.register(multipart, {
    limits: {
      files: 2,
      fileSize: options.maxUploadSize,
      fields: 10,
    },
    throwFileSizeLimit: true,
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

  const controller = new FileController(
    options.fileService,
    (request) =>
      !options.adminToken ||
      hasValidAdminToken(
        request.headers.authorization,
        options.adminToken,
      ),
    (request) =>
      Boolean(options.adminToken) &&
      hasValidAdminToken(
        request.headers.authorization,
        options.adminToken,
      ),
  );
  app.get("/api/admin/status", async () => ({
    data: { required: Boolean(options.adminToken) },
  }));
  app.post("/api/admin/verify", async () => ({
    data: { authenticated: true },
  }));
  app.get(
    "/api/storage-locations",
    controller.listStorageLocations,
  );
  app.post(
    "/api/storage-locations",
    controller.createStorageLocation,
  );
  app.patch(
    "/api/storage-locations/:id",
    controller.updateStorageLocation,
  );
  app.post(
    "/api/storage-locations/:id/unlock",
    controller.unlockStorageLocation,
  );
  app.delete(
    "/api/storage-locations/:id",
    controller.deleteStorageLocation,
  );
  app.get("/api/tags", controller.listTags);
  app.get("/api/statistics", async (request, reply) => {
    if (!options.statisticsService) {
      throw new AppError(
        503,
        "STATISTICS_UNAVAILABLE",
        "统计服务暂不可用",
      );
    }
    await reply
      .header("cache-control", "no-store")
      .send(
        await options.statisticsService.getStatistics(
          !options.adminToken ||
            hasValidAdminToken(
              request.headers.authorization,
              options.adminToken,
            ),
        ),
      );
  });
  app.get("/api/statistics/activity", async (request, reply) => {
    if (!options.statisticsService) {
      throw new AppError(
        503,
        "STATISTICS_UNAVAILABLE",
        "统计服务暂不可用",
      );
    }
    const after = (request.query as { after?: string }).after ?? "0";
    if (!/^\d{1,20}$/.test(after)) {
      throw new AppError(400, "INVALID_ACTIVITY_CURSOR", "新增记录游标无效");
    }
    await reply
      .header("cache-control", "no-store")
      .send(
        await options.statisticsService.getActivity(
          BigInt(after),
          20,
          !options.adminToken ||
            hasValidAdminToken(
              request.headers.authorization,
              options.adminToken,
            ),
        ),
      );
  });
  await app.register(createFileRoutes(controller), {
    prefix: "/api/files",
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/about", async (_request, reply) => {
    await reply.sendFile("about.html");
  });

  await app.register(fastifyStatic, {
    root: fileURLToPath(new URL("../web", import.meta.url)),
    index: "index.html",
    wildcard: false,
  });
  await app.register(fastifyStatic, {
    root: fileURLToPath(
      new URL("../node_modules/echarts/dist", import.meta.url),
    ),
    prefix: "/vendor/",
    decorateReply: false,
    wildcard: false,
  });

  app.setNotFoundHandler(async (_request, reply) => {
    await reply.code(404).send({
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "接口不存在",
      },
    });
  });

  return app;
}

function secureTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}

function hasValidAdminToken(
  authorization: string | undefined,
  adminToken: string,
): boolean {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return Boolean(
    match && secureTokenEquals(match[1]!, adminToken),
  );
}

function isAnonymousWriteRequest(method: string, url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  if (
    method === "PUT" &&
    /^\/api\/files\/[^/]+\/tags$/.test(path)
  ) {
    return true;
  }
  if (method !== "POST") return false;
  return (
    /^\/api\/storage-locations\/[^/]+\/unlock$/.test(path) ||
    path === "/api/files/folder" ||
    path === "/api/files/upload" ||
    /^\/api\/files\/[^/]+\/copy$/.test(path)
  );
}
