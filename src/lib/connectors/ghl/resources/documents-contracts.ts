import "server-only";

import type { GhlDocument } from "../types";

/**
 * Documents/Contracts resource module.
 *
 * Note: The GHL Documents/Contracts API endpoints may differ from standard patterns.
 * This module provides soft-fail behavior if the endpoints are unavailable.
 *
 * Prompt 2 will implement write operations.
 */

export async function listDocuments(): Promise<GhlDocument[]> {
  console.warn("[GHL Documents] Documents API endpoint not yet confirmed. Returning empty.");
  return [];
}

export async function getDocumentById(_documentId: string): Promise<GhlDocument | null> {
  console.warn("[GHL Documents] Documents API endpoint not yet confirmed. Returning null.");
  return null;
}

export async function listDocumentsForContact(_contactId: string): Promise<GhlDocument[]> {
  console.warn("[GHL Documents] Documents API endpoint not yet confirmed. Returning empty.");
  return [];
}
