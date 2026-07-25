import { describe, expect, it } from "vitest";
import { toPublicError } from "@/lib/errors";

describe("admin role update errors", () => {
  it("surfaces postgres role-management messages instead of generic unexpected error", () => {
    const publicError = toPublicError(
      Object.assign(new Error("Only admins can change profile roles"), {
        code: "P0001",
        expose: true,
      }),
    );
    expect(publicError.message).toMatch(/Only admins can change profile roles/i);
    expect(publicError.statusCode).toBe(400);
  });

  it("surfaces super-admin restriction copy", () => {
    const publicError = toPublicError(
      Object.assign(
        new Error("Only the super-admin (baxter@actonadu.com) can grant admin access"),
        {
          expose: true,
        },
      ),
    );
    expect(publicError.message).toMatch(/super-admin/i);
  });
});
