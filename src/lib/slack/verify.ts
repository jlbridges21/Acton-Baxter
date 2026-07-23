import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

const MAX_SKEW_SECONDS = 60 * 5;

export class SlackSignatureError extends AppError {
  constructor(message = "Invalid Slack signature") {
    super(message, { code: "SLACK_SIGNATURE_ERROR", statusCode: 401, expose: true });
    this.name = "SlackSignatureError";
  }
}

export function verifySlackRequest(options: {
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  signingSecret?: string;
  nowSeconds?: number;
}): void {
  const signingSecret =
    options.signingSecret ??
    (() => {
      try {
        return getEnv().SLACK_SIGNING_SECRET;
      } catch {
        return "";
      }
    })();
  if (!signingSecret) {
    throw new SlackSignatureError("Slack signing secret is not configured");
  }
  if (!options.signature || !options.timestamp) {
    throw new SlackSignatureError("Missing Slack signature headers");
  }

  const timestamp = Number(options.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new SlackSignatureError("Invalid Slack timestamp");
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_SKEW_SECONDS) {
    throw new SlackSignatureError("Slack request timestamp is too old");
  }

  const base = `v0:${options.timestamp}:${options.rawBody}`;
  const digest = createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = `v0=${digest}`;

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(options.signature, "utf8");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new SlackSignatureError();
  }
}
