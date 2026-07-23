import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, logServerError, toPublicError } from "@/lib/errors";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(error: unknown, context: string) {
  logServerError(context, error);

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "Invalid request",
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof AppError || error instanceof Error) {
    const publicError = toPublicError(error);
    return NextResponse.json(
      {
        error: {
          code: publicError.code,
          message: publicError.message,
        },
      },
      { status: publicError.statusCode },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    },
    { status: 500 },
  );
}
