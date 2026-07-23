import { AppError } from "@/lib/errors";

export class AddressError extends AppError {
  constructor(message: string, options?: { statusCode?: number; code?: string }) {
    super(message, {
      statusCode: options?.statusCode ?? 400,
      code: options?.code ?? "ADDRESS_ERROR",
      expose: true,
    });
  }
}
