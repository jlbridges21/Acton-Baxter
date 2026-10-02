import "server-only";

import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/admin";
import type { SchemaErd } from "@/lib/schema-erd/types";

const columnSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
});

const schemaErdSchema = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(columnSchema),
    }),
  ),
  foreignKeys: z.array(
    z.object({
      constraintName: z.string(),
      sourceTable: z.string(),
      sourceColumns: z.array(z.string()),
      targetTable: z.string(),
      targetColumns: z.array(z.string()),
    }),
  ),
});

export async function loadSchemaErd(): Promise<{ schema: SchemaErd | null; error: string | null }> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("admin_schema_erd");
    if (error) {
      return { schema: null, error: error.message || "Could not load the schema." };
    }
    const parsed = schemaErdSchema.safeParse(data);
    if (!parsed.success) return { schema: null, error: "The schema response was not valid." };
    return { schema: parsed.data, error: null };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Could not load the schema.";
    return { schema: null, error: message };
  }
}
