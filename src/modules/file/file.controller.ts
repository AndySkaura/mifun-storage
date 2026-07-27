import type {
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { AppError } from "../../utils/app-error.js";
import { parseId } from "../../utils/bigint.js";
import type { FileService } from "./file.service.js";

interface ParentQuery {
  parentId?: string;
}

interface IdParams {
  id: string;
}

interface CreateFolderBody {
  name?: string;
  parentId?: string | number | null;
}

export class FileController {
  constructor(private readonly service: FileService) {}

  createFolder = async (
    request: FastifyRequest<{ Body: CreateFolderBody }>,
    reply: FastifyReply,
  ): Promise<void> => {
    if (typeof request.body?.name !== "string") {
      throw new AppError(400, "INVALID_NAME", "name 为必填字符串");
    }

    const folder = await this.service.createFolder({
      name: request.body.name,
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
    const files = await this.service.listFiles(parentId);
    await reply.send({ data: files });
  };

  getFile = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const file = await this.service.getFile(
      requiredId(request.params.id, "id"),
    );
    await reply.send({ data: file });
  };

  uploadFile = async (
    request: FastifyRequest<{ Querystring: ParentQuery }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const part = await request.file();

    if (!part) {
      throw new AppError(
        400,
        "FILE_REQUIRED",
        "multipart/form-data 中必须包含 file",
      );
    }

    const fieldParentId =
      "parentId" in part.fields
        ? part.fields.parentId
        : request.query.parentId;
    const parentId = parseId(fieldParentId, "parentId", {
      optional: true,
    });
    const file = await this.service.uploadFile({
      parentId,
      filename: part.filename,
      mimeType: part.mimetype,
      stream: part.file,
      isTruncated: () => part.file.truncated,
    });

    await reply.code(201).send({ data: file });
  };

  downloadFile = async (
    request: FastifyRequest<{ Params: IdParams }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.downloadFile(
      requiredId(request.params.id, "id"),
    );
    const fallback = result.filename.replace(/["\r\n]/g, "_");
    const encoded = encodeURIComponent(result.filename);

    reply
      .header("content-type", result.mimeType)
      .header("content-length", result.size.toString())
      .header(
        "content-disposition",
        `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
      );
    await reply.send(result.stream);
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
}

function requiredId(value: string, fieldName: string): bigint {
  const parsed = parseId(value, fieldName);
  if (parsed === null) {
    throw new AppError(400, "INVALID_ID", `${fieldName} 必须是正整数`);
  }
  return parsed;
}
