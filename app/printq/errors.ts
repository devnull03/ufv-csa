import { NextResponse } from "next/server";

export type PrintQErrorCode =
  | "bad_request"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "too_large"
  | "unsupported_file"
  | "wrong_printer"
  | "too_long"
  | "quota_exceeded"
  | "slot_unavailable"
  | "invalid_transition";

const STATUS: Record<PrintQErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  too_large: 413,
  unsupported_file: 415,
  wrong_printer: 422,
  too_long: 422,
  quota_exceeded: 422,
  slot_unavailable: 409,
  invalid_transition: 409,
};

export class PrintQError extends Error {
  constructor(
    readonly code: PrintQErrorCode,
    message: string
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof PrintQError) {
    return NextResponse.json({ error: error.code, message: error.message }, { status: STATUS[error.code] });
  }
  console.error(error);
  return NextResponse.json({ error: "internal", message: "Something went wrong" }, { status: 500 });
}

// Postgres error code, looking through drizzle's query-error wrapper.
export function pgErrorCode(error: unknown): string | undefined {
  for (let current = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}
