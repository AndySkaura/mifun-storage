import { AppError } from "./app-error.js";

export function parseId(
  value: unknown,
  fieldName: string,
  options: { optional?: boolean } = {},
): bigint | null {
  if (
    options.optional &&
    (value === undefined || value === null || value === "")
  ) {
    return null;
  }

  const raw =
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
      ? value.value
      : value;

  if (
    (typeof raw !== "string" && typeof raw !== "number") ||
    !/^[1-9]\d*$/.test(String(raw))
  ) {
    throw new AppError(
      400,
      "INVALID_ID",
      `${fieldName} 必须是正整数`,
    );
  }

  return BigInt(raw);
}
