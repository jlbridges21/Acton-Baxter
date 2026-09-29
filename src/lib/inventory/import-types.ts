export type ImportDraftLine = {
  itemName: string;
  sku: string;
  description: string | null;
  quantity: number | null;
  unitCostCents: number | null;
  lineTotalCents: number | null;
  productUrl: string | null;
  photoStoragePath: string | null;
  photoUrl: string | null;
  source: "text" | "vision";
  flags: string[];
  pageNumber: number;
};

export type ImportDuplicate = {
  orderId: string;
  orderNumber: string | null;
  match: "file" | "order_number";
};

export type ImportDraft = {
  sha256: string;
  storagePath: string;
  orderNumber: string | null;
  vendor: string;
  source: "text" | "vision";
  correctionAttempted: boolean;
  textUsable: boolean;
  lines: ImportDraftLine[];
  duplicate: ImportDuplicate | null;
};

export type CommitImportLine = {
  itemName: string;
  sku: string;
  description?: string | null;
  quantity: number;
  unitCostCents: number;
  productUrl?: string | null;
  photoStoragePath?: string | null;
};
