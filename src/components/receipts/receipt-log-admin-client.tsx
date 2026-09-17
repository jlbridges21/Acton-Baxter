"use client";

import { RECEIPT_LOG_PATH, type ReceiptLogFiltersState } from "@/lib/receipts/log-filter-url";
import type { ReceiptLogRow } from "@/lib/receipts/log-query";
import { ReceiptLogListClient } from "./receipt-log-list-client";

/** Admin all-users Receipt Log — thin wrapper over the shared list. */
export function ReceiptLogAdminClient(props: {
  rows: ReceiptLogRow[];
  filters: ReceiptLogFiltersState;
  totalMatching: number;
  totalAmountCents: number;
  hasMore: boolean;
  nextOffset: number;
  exportHref: string;
}) {
  return <ReceiptLogListClient {...props} basePath={RECEIPT_LOG_PATH} variant="admin" />;
}
