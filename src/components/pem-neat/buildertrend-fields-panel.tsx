"use client";

import { useMemo } from "react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/pem-neat/copy-button";
import {
  BUILDERTREND_FIELD_DEFS,
  buildCopyAllFieldsText,
  getCopyableValue,
  getDisplayValue,
} from "@/lib/pem-neat/buildertrend-display";
import type { BuildertrendFields } from "@/lib/pem-neat/schemas";
import { cn } from "@/lib/utils";

function FieldRow({
  label,
  displayValue,
  copyableValue,
  isBulletList,
}: {
  label: string;
  displayValue: string;
  copyableValue: string;
  isBulletList?: boolean;
}) {
  const bullets = useMemo(() => {
    if (!isBulletList || !copyableValue) return null;
    return copyableValue
      .split("\n")
      .map((line) => line.replace(/^-\s*/, ""))
      .filter(Boolean);
  }, [copyableValue, isBulletList]);

  return (
    <div className="rounded-md border border-[var(--acton-border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <dt className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase">
          {label}
        </dt>
        <CopyButton
          getText={() => copyableValue}
          label="Copy"
          copiedLabel="Copied"
          variant="ghost"
          size="sm"
          className="shrink-0"
        />
      </div>
      <dd className="mt-2 text-sm text-[var(--acton-navy)]">
        {bullets && bullets.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5">
            {bullets.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <span className={cn(displayValue === "Not established" && "text-[var(--acton-muted)]")}>
            {displayValue}
          </span>
        )}
      </dd>
    </div>
  );
}

export function BuildertrendFieldsPanel({ fields }: { fields: BuildertrendFields }) {
  const copyAllText = useMemo(() => buildCopyAllFieldsText(fields), [fields]);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>BuilderTrend Custom Fields</CardTitle>
          <CardDescription>
            Structured handoff fields for copy/paste into BuilderTrend. Values are blank when not
            established in the transcript.
          </CardDescription>
        </div>
        <CopyButton
          getText={() => copyAllText}
          label="Copy All Fields"
          copiedLabel="Copied"
          variant="secondary"
        />
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {BUILDERTREND_FIELD_DEFS.map((def) => (
          <FieldRow
            key={def.key}
            label={def.label}
            displayValue={getDisplayValue(fields, def)}
            copyableValue={getCopyableValue(fields, def)}
            isBulletList={def.isBulletList}
          />
        ))}
      </dl>

      <p className="mt-4 text-xs text-[var(--acton-muted)]">
        BuilderTrend API integration is not available — this is a structured handoff only.
      </p>
    </Card>
  );
}
