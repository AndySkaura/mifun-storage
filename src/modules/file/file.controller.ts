import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { AppError } from "../../utils/app-error.js";
import { parseId } from "../../utils/bigint.js";
import type {
  FileService,
  PrivateContentMode,
} from "./file.service.js";
import type {
  FilePageOptions,
  FileSortBy,
  SortOrder,
} from "./file.types.js";

interface PageQuery {
  offset?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  storageLocationId?: string;
}

interface ParentQuery extends PageQuery {
  parentId?: string;
}

interface SearchQuery extends PageQuery {
  q?: string;
}

interface IdParams {
  id: string;
}

interface ContentTokenParams {
  token: string;
}

interface PrivateContentLinksBody {
  fileIds?: unknown;
}

interface PrivateContentQuery {
  m?: string;
}

interface CreateFolderBody {
  name?: string;
  parentId?: string | number | null;
  storageLocationId?: string | number;
}

interface CopyFileBody {
  parentId?: string | number | null;
  storageLocationId?: string | number;
}

interface TagParams {
  slug: string;
}

interface SetTagsBody {
  tags?: unknown;
}

interface StorageLocationBody {
  name?: unknown;
  anonymousAccess?: unknown;
}

const privateContentModes: Record<string, PrivateContentMode> = {
  p: "preview",
  d: "download",
  t: "thumbnail",
};

export class FileController {
  constructor(
    private readonly service: FileService,
    private readonly isAdmin: (request: FastifyRequest) => boolean,
  ) {}

  listStorageLocations = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    await reply.send({
      data: await this.service.listStorageLocations(
        this.isAdmin(request),
      ),
    });
  };

  createStorageLocation = async (
    request: FastifyRequest<{ Body: StorageLocationBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await reply.code(201).send({
      data: await this.service.createStorageLocation(
        parseStorageLocationBody(request.body),
      ),
    });
  };

  updateStorageLocation = async (
    request: FastifyRequest<{
      Params: IdParams;
      Body: StorageLocationBody;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await reply.send({
      data: await this.service.updateStorageLocation({
        id: requiredId(request.params.id, "id"),
        ...parseStorageLocationBody(request.body),
      }),
    });
  };

  deleteStorageLocation = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.deleteStorageLocation(
      requiredId(request.params.id, "id"),
    );
    await reply.code(204).send();
  };

  createFolder = async (
    request: FastifyRequest<{ Body: CreateFolderBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (typeof request.body?.name !== "string") {
      throw new AppError(400, "INVALID_NAME", "name 为必填字符串");
    }

    const storageLocationId = parseStorageLocationId(
      request.body.storageLocationId,
    );
    await this.service.requireStorageAccess(
      storageLocationId,
      "write",
      this.isAdmin(request),
    );
    const folder = await this.service.createFolder({
      name: request.body.name,
      storageLocationId,
      parentId: parseId(request.body.parentId, "parentId", {
        optional: true,
      }),
    });
    await reply.code(201).send({ data: folder });
  };

  listFiles = async (
    request: FastifyRequest<{ Querystring: ParentQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const parentId = parseId(request.query.parentId, "parentId", {
      optional: true,
    });
    const storageLocationId = parseStorageLocationId(
      request.query.storageLocationId,
    );
    await this.service.requireStorageAccess(
      storageLocationId,
      "read",
      this.isAdmin(request),
    );
    const page = await this.service.listFiles(
      storageLocationId,
      parentId,
      parsePageOptions(request.query),
    );
    await reply.send(page);
  };

  searchFiles = async (
    request: FastifyRequest<{ Querystring: SearchQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (typeof request.query.q !== "string") {
      throw new AppError(
        400,
        "INVALID_SEARCH_QUERY",
        "q 为必填字符串",
      );
    }
    const storageLocationId = parseStorageLocationId(
      request.query.storageLocationId,
    );
    await this.service.requireStorageAccess(
      storageLocationId,
      "read",
      this.isAdmin(request),
    );
    const page = await this.service.searchFiles(
      storageLocationId,
      request.query.q,
      parsePageOptions(request.query),
    );
    await reply.send(page);
  };

  getFile = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const file = await this.service.getFile(
      requiredId(request.params.id, "id"),
    );
    await this.service.requireStorageAccess(
      BigInt(file.storageLocationId),
      "read",
      this.isAdmin(request),
    );
    await reply.send({ data: file });
  };

  listTags = async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    await reply.send({ data: await this.service.listTags() });
  };

  listFilesByTag = async (
    request: FastifyRequest<{
      Params: TagParams;
      Querystring: PageQuery;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const storageLocationId = parseStorageLocationId(
      request.query.storageLocationId,
    );
    await this.service.requireStorageAccess(
      storageLocationId,
      "read",
      this.isAdmin(request),
    );
    const page = await this.service.listFilesByTag(
      storageLocationId,
      request.params.slug,
      parsePageOptions(request.query),
    );
    await reply.send(page);
  };

  setFileTags = async (
    request: FastifyRequest<{
      Params: IdParams;
      Body: SetTagsBody;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (
      !Array.isArray(request.body?.tags) ||
      !request.body.tags.every((tag) => typeof tag === "string")
    ) {
      throw new AppError(
        400,
        "INVALID_TAGS",
        "tags 必须是字符串数组",
      );
    }

    const file = await this.service.setFileTags(
      requiredId(request.params.id, "id"),
      request.body.tags,
      this.isAdmin(request),
    );
    await reply.send({ data: file });
  };

  uploadFile = async (
    request: FastifyRequest<{ Querystring: ParentQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    let parentIdInput: unknown = request.query.parentId;
    const storageLocationId = parseStorageLocationId(
      request.query.storageLocationId,
    );
    await this.service.requireStorageAccess(
      storageLocationId,
      "write",
      this.isAdmin(request),
    );
    let thumbnail: Buffer | undefined;

    for await (const part of request.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "parentId") {
          parentIdInput = part.value;
        }
        continue;
      }

      if (part.fieldname === "thumbnail") {
        if (thumbnail) {
          throw new AppError(
            400,
            "DUPLICATE_THUMBNAIL",
            "只能上传一个缩略图",
          );
        }
        if (part.mimetype !== "image/jpeg") {
          part.file.resume();
          throw new AppError(
            415,
            "INVALID_THUMBNAIL_TYPE",
            "缩略图必须是 JPEG 图片",
          );
        }
        thumbnail = await part.toBuffer();
        if (
          part.file.truncated ||
          thumbnail.length >= 200 * 1024
        ) {
          throw new AppError(
            413,
            "THUMBNAIL_TOO_LARGE",
            "缩略图必须小于 200 KiB",
          );
        }
        continue;
      }

      if (part.fieldname !== "file") {
        part.file.resume();
        throw new AppError(
          400,
          "UNEXPECTED_FILE_FIELD",
          `不支持的文件字段：${part.fieldname}`,
        );
      }

      const parentId = parseId(parentIdInput, "parentId", {
        optional: true,
      });
      const file = await this.service.uploadFile({
        storageLocationId,
        parentId,
        filename: part.filename,
        mimeType: part.mimetype,
        stream: part.file,
        thumbnail,
        isTruncated: () => part.file.truncated,
      });
      await reply.code(201).send({ data: file });
      return;
    }

    throw new AppError(
      400,
      "FILE_REQUIRED",
      "multipart/form-data 中必须包含 file",
    );
  };

  downloadFile = async (
    request: FastifyRequest<{ Params: ContentTokenParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.downloadFileByContentToken(
      request.params.token,
    );

    reply
      .header("content-type", safeMimeType(result.mimeType))
      .header("content-length", result.size.toString())
      .header("cache-control", "public, max-age=31536000, immutable")
      .header(
        "content-disposition",
        createContentDisposition(result.filename),
      );
    await reply.send(result.stream);
  };

  previewImage = async (
    request: FastifyRequest<{ Params: ContentTokenParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.downloadFileByContentToken(
      request.params.token,
    );
    const mimeType = previewImageMimeType(
      result.mimeType,
      result.filename,
    );

    if (!mimeType) {
      result.stream.destroy();
      throw new AppError(
        415,
        "FILE_NOT_PREVIEWABLE",
        "该文件不是支持预览的图片",
      );
    }

    reply
      .header("content-type", mimeType)
      .header("content-length", result.size.toString())
      .header(
        "content-disposition",
        createContentDisposition(result.filename, "inline"),
      )
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff");
    await reply.send(result.stream);
  };

  thumbnailImage = async (
    request: FastifyRequest<{ Params: ContentTokenParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.downloadThumbnailByContentToken(
      request.params.token,
    );

    reply
      .header("content-type", "image/jpeg")
      .header(
        "content-disposition",
        createContentDisposition(result.filename, "inline"),
      )
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("x-content-type-options", "nosniff");
    if (result.size > 0n) {
      reply.header("content-length", result.size.toString());
    }
    await reply.send(result.stream);
  };

  createPrivateContentLinks = async (
    request: FastifyRequest<{ Body: PrivateContentLinksBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (
      !Array.isArray(request.body?.fileIds) ||
      request.body.fileIds.length === 0 ||
      request.body.fileIds.length > 100
    ) {
      throw new AppError(
        400,
        "INVALID_PRIVATE_CONTENT_FILES",
        "fileIds 必须包含1到100个文件 ID",
      );
    }
    const fileIds = request.body.fileIds.map((id) =>
      requiredId(id, "fileId")
    );
    await reply.send({
      data: await this.service.createPrivateContentLinks(fileIds),
    });
  };

  privateContent = async (
    request: FastifyRequest<{
      Params: ContentTokenParams;
      Querystring: PrivateContentQuery;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (!this.isAdmin(request)) {
      reply.header("www-authenticate", "Bearer");
      throw new AppError(
        401,
        "ADMIN_AUTH_REQUIRED",
        "需要有效的管理员 Bearer Token 才能访问私有内容",
      );
    }

    const mode = privateContentModes[request.query.m ?? ""];
    if (!mode) {
      throw new AppError(
        400,
        "INVALID_PRIVATE_CONTENT_MODE",
        "m 必须是 p、d 或 t",
      );
    }

    const result = await this.service.downloadPrivateContent(
      request.params.token,
      mode,
    );
    let mimeType = safeMimeType(result.mimeType);
    if (mode === "thumbnail") {
      mimeType = "image/jpeg";
    } else if (mode === "preview") {
      const previewMimeType = previewImageMimeType(
        result.mimeType,
        result.filename,
      );
      if (!previewMimeType) {
        result.stream.destroy();
        throw new AppError(
          415,
          "FILE_NOT_PREVIEWABLE",
          "该文件不是支持预览的图片",
        );
      }
      mimeType = previewMimeType;
    }

    reply
      .header("content-type", mimeType)
      .header(
        "content-disposition",
        createContentDisposition(
          result.filename,
          mode === "download" ? "attachment" : "inline",
        ),
      )
      .header(
        "cache-control",
        "private, max-age=31536000, immutable",
      )
      .header("cloudflare-cdn-cache-control", "no-store")
      .header("vary", "Authorization")
      .header("x-content-type-options", "nosniff");
    if (result.size > 0n) {
      reply.header("content-length", result.size.toString());
    }
    await reply.send(result.stream);
  };

  copyFile = async (
    request: FastifyRequest<{
      Params: IdParams;
      Body: CopyFileBody;
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const sourceId = requiredId(request.params.id, "id");
    await this.requireEntryReadAccess(sourceId, request);
    const storageLocationId = parseStorageLocationId(
      request.body?.storageLocationId,
    );
    await this.service.requireStorageAccess(
      storageLocationId,
      "write",
      this.isAdmin(request),
    );
    const file = await this.service.copyFile(
      sourceId,
      storageLocationId,
      parseId(request.body?.parentId, "parentId", {
        optional: true,
      }),
    );
    await reply.code(201).send({ data: file });
  };

  deleteFile = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    await this.service.deleteFile(
      requiredId(request.params.id, "id"),
    );
    await reply.code(204).send();
  };

  private async requireEntryReadAccess(
    id: bigint,
    request: FastifyRequest,
  ): Promise<void> {
    const entry = await this.service.getFile(id);
    await this.service.requireStorageAccess(
      BigInt(entry.storageLocationId),
      "read",
      this.isAdmin(request),
    );
  }
}

const fileSortFields = new Set<FileSortBy>([
  "name",
  "updatedAt",
  "size",
]);
const sortOrders = new Set<SortOrder>(["asc", "desc"]);

function parsePageOptions(query: PageQuery): FilePageOptions {
  const offset = parsePageInteger(
    query.offset,
    "offset",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const limit = parsePageInteger(query.limit, "limit", 50, 100);
  const sortBy = query.sortBy ?? "name";
  const sortOrder = query.sortOrder ?? "asc";

  if (!fileSortFields.has(sortBy as FileSortBy)) {
    throw new AppError(
      400,
      "INVALID_SORT_FIELD",
      "sortBy 仅支持 name、updatedAt 或 size",
    );
  }
  if (!sortOrders.has(sortOrder as SortOrder)) {
    throw new AppError(
      400,
      "INVALID_SORT_ORDER",
      "sortOrder 仅支持 asc 或 desc",
    );
  }

  return {
    offset,
    limit,
    sortBy: sortBy as FileSortBy,
    sortOrder: sortOrder as SortOrder,
  };
}

function parsePageInteger(
  value: string | undefined,
  fieldName: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new AppError(
      400,
      "INVALID_PAGINATION",
      `${fieldName} 必须是非负整数`,
    );
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < (fieldName === "limit" ? 1 : 0) ||
    parsed > maximum
  ) {
    throw new AppError(
      400,
      "INVALID_PAGINATION",
      fieldName === "limit"
        ? "limit 必须在 1 到 100 之间"
        : "offset 超出有效范围",
    );
  }
  return parsed;
}

function requiredId(value: unknown, fieldName: string): bigint {
  const parsed = parseId(value, fieldName);
  if (parsed === null) {
    throw new AppError(400, "INVALID_ID", `${fieldName} 必须是正整数`);
  }
  return parsed;
}

function parseStorageLocationId(value: unknown): bigint {
  return value === undefined
    ? 1n
    : requiredId(value, "storageLocationId");
}

function parseStorageLocationBody(body: StorageLocationBody | undefined): {
  name: string;
  anonymousAccess: "hidden" | "read" | "write";
} {
  if (typeof body?.name !== "string") {
    throw new AppError(
      400,
      "INVALID_STORAGE_LOCATION_NAME",
      "name 为必填字符串",
    );
  }
  if (
    body.anonymousAccess !== "hidden" &&
    body.anonymousAccess !== "read" &&
    body.anonymousAccess !== "write"
  ) {
    throw new AppError(
      400,
      "INVALID_ANONYMOUS_ACCESS",
      "anonymousAccess 必须是 hidden、read 或 write",
    );
  }
  return {
    name: body.name,
    anonymousAccess: body.anonymousAccess,
  };
}

function createContentDisposition(
  filename: string,
  disposition: "attachment" | "inline" = "attachment",
): string {
  const fallback =
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_")
      .trim() || "download";
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function safeMimeType(mimeType: string): string {
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(mimeType)
    ? mimeType
    : "application/octet-stream";
}

function previewImageMimeType(
  mimeType: string,
  filename: string,
): string | null {
  const safe = safeMimeType(mimeType);
  if (safe.startsWith("image/")) return safe;

  const extension = filename.split(".").pop()?.toLowerCase();
  const fallbackTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
  };
  return extension ? fallbackTypes[extension] ?? null : null;
}
