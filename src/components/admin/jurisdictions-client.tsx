"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  JURISDICTION_RULE_KEY_CATALOG,
  defaultUnitForRuleKey,
  type JurisdictionRuleKeyMeta,
} from "@/lib/jurisdictions/rule-keys";
import type { SupportedJurisdiction } from "@/lib/jurisdictions/supported";
import type {
  JurisdictionRule,
  JurisdictionRuleValueJson,
  KnowledgeDocKind,
} from "@/lib/jurisdictions/types";

type AssociableEntry = {
  id: string;
  title: string;
  status: string;
  jurisdiction_key: string | null;
  doc_kind: KnowledgeDocKind | null;
  source_name: string | null;
  source_url: string | null;
  updated_at: string;
};

type Payload = {
  jurisdictions: SupportedJurisdiction[];
  ruleKeyCatalog: JurisdictionRuleKeyMeta[];
  rules: JurisdictionRule[];
  documentsByJurisdiction: Record<string, AssociableEntry[]>;
  associableEntries: AssociableEntry[];
};

const DOC_KIND_OPTIONS: Array<{ value: KnowledgeDocKind; label: string }> = [
  { value: "building_code", label: "Building code" },
  { value: "ordinance", label: "Ordinance" },
  { value: "design_guideline", label: "Design guideline" },
  { value: "other_code", label: "Other code document" },
];

function formatValue(value: JurisdictionRuleValueJson): string {
  if (value.kind === "quantity") return `${value.value} ${value.unit}`;
  return Object.entries(value.fields)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join("; ");
}

export function JurisdictionsClient({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial);
  const [selectedKey, setSelectedKey] = useState<string>(
    initial.jurisdictions[0]?.key ?? "ca-san-jose",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Associate form
  const [entryId, setEntryId] = useState("");
  const [docKind, setDocKind] = useState<KnowledgeDocKind>("building_code");

  // Rule form
  const [ruleKeyMode, setRuleKeyMode] = useState<"catalog" | "custom">("catalog");
  const [ruleKey, setRuleKey] = useState(JURISDICTION_RULE_KEY_CATALOG[0]?.key ?? "");
  const [customRuleKey, setCustomRuleKey] = useState("");
  const [zoneKey, setZoneKey] = useState("");
  const [quantityValue, setQuantityValue] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("ft");
  const [sourceCitation, setSourceCitation] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceEntryId, setSourceEntryId] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/jurisdictions");
    const payload = (await response.json()) as Payload & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload.error?.message ?? "Unable to load jurisdictions");
    }
    setData(payload);
  }, []);

  const selectedJurisdiction = useMemo(
    () => data.jurisdictions.find((item) => item.key === selectedKey) ?? null,
    [data, selectedKey],
  );

  const rulesForSelected = useMemo(
    () => data.rules.filter((rule) => rule.jurisdiction_key === selectedKey),
    [data, selectedKey],
  );

  const docsForSelected = data.documentsByJurisdiction[selectedKey] ?? [];

  const availableToAssociate = useMemo(() => {
    return data.associableEntries.filter(
      (entry) => entry.jurisdiction_key !== selectedKey || !entry.doc_kind,
    );
  }, [data, selectedKey]);

  function resetRuleForm() {
    setEditingRuleId(null);
    setRuleKeyMode("catalog");
    setRuleKey(JURISDICTION_RULE_KEY_CATALOG[0]?.key ?? "");
    setCustomRuleKey("");
    setZoneKey("");
    setQuantityValue("");
    setQuantityUnit("ft");
    setSourceCitation("");
    setNotes("");
    setSourceEntryId("");
  }

  function startEditRule(rule: JurisdictionRule) {
    setEditingRuleId(rule.id);
    const known = JURISDICTION_RULE_KEY_CATALOG.some((item) => item.key === rule.rule_key);
    setRuleKeyMode(known ? "catalog" : "custom");
    setRuleKey(known ? rule.rule_key : (JURISDICTION_RULE_KEY_CATALOG[0]?.key ?? ""));
    setCustomRuleKey(known ? "" : rule.rule_key);
    setZoneKey(rule.zone_key ?? "");
    if (rule.value_json.kind === "quantity") {
      setQuantityValue(String(rule.value_json.value));
      setQuantityUnit(rule.value_json.unit);
    } else {
      setQuantityValue("");
      setQuantityUnit(defaultUnitForRuleKey(rule.rule_key) || "ft");
    }
    setSourceCitation(rule.source_citation);
    setNotes(rule.notes ?? "");
    setSourceEntryId(rule.source_knowledge_entry_id ?? "");
  }

  async function postAction(body: unknown) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/jurisdictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Request failed");
      }
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onAssociate(e: React.FormEvent) {
    e.preventDefault();
    if (!entryId) {
      setError("Select a knowledge entry to associate.");
      return;
    }
    const ok = await postAction({
      action: "associate_entry",
      association: {
        knowledge_entry_id: entryId,
        jurisdiction_key: selectedKey,
        doc_kind: docKind,
      },
    });
    if (ok) {
      setMessage("Knowledge entry associated as a code document.");
      setEntryId("");
    }
  }

  async function onClearAssociation(id: string) {
    const ok = await postAction({
      action: "associate_entry",
      association: {
        knowledge_entry_id: id,
        jurisdiction_key: null,
        doc_kind: null,
      },
    });
    if (ok) setMessage("Association cleared.");
  }

  async function onSaveRule(e: React.FormEvent) {
    e.preventDefault();
    const resolvedKey = ruleKeyMode === "catalog" ? ruleKey : customRuleKey.trim();
    if (!resolvedKey) {
      setError("Choose or enter a rule key.");
      return;
    }
    if (!sourceCitation.trim()) {
      setError("Source citation is required (document name + section).");
      return;
    }
    const numeric = Number(quantityValue);
    if (!Number.isFinite(numeric)) {
      setError("Enter a numeric rule value.");
      return;
    }
    const unit = quantityUnit.trim() || defaultUnitForRuleKey(resolvedKey) || "ft";
    const rule = {
      jurisdiction_key: selectedKey,
      rule_key: resolvedKey,
      zone_key: zoneKey.trim() || null,
      value_json: {
        kind: "quantity" as const,
        value: numeric,
        unit,
      },
      source_citation: sourceCitation.trim(),
      source_knowledge_entry_id: sourceEntryId.trim() || null,
      notes: notes.trim() || null,
    };

    const ok = await postAction(
      editingRuleId
        ? { action: "update_rule", id: editingRuleId, rule }
        : { action: "create_rule", rule },
    );
    if (ok) {
      setMessage(editingRuleId ? "Rule updated." : "Rule created.");
      resetRuleForm();
    }
  }

  async function onDeleteRule(id: string) {
    if (!window.confirm("Delete this jurisdiction rule?")) return;
    const ok = await postAction({ action: "delete_rule", id });
    if (ok) setMessage("Rule deleted.");
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--acton-navy)]">Jurisdictions & ADU codes</h1>
        <p className="mt-1 text-sm text-[var(--acton-muted)]">
          Associate municipal-code knowledge documents and maintain structured, citation-required
          rules for Property Research. Keys match connector IDs used by live research.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Supported jurisdictions</h2>
        <div className="flex flex-wrap gap-2">
          {(data.jurisdictions ?? []).map((jurisdiction) => (
            <Button
              key={jurisdiction.key}
              type="button"
              variant={selectedKey === jurisdiction.key ? "primary" : "secondary"}
              onClick={() => {
                setSelectedKey(jurisdiction.key);
                resetRuleForm();
                setMessage(null);
                setError(null);
              }}
            >
              {jurisdiction.name}
            </Button>
          ))}
        </div>
        {selectedJurisdiction ? (
          <Card>
            <CardTitle>{selectedJurisdiction.name}</CardTitle>
            <CardDescription className="mt-1">
              Key <code className="text-xs">{selectedJurisdiction.key}</code> ·{" "}
              {selectedJurisdiction.county} County, {selectedJurisdiction.state}
            </CardDescription>
            <p className="mt-3 text-sm text-[var(--acton-muted)]">
              Upload new code PDFs via the{" "}
              <Link
                href={`/admin/knowledge/upload?jurisdiction=${selectedJurisdiction.key}&doc_kind=building_code`}
                className="font-medium text-[var(--acton-navy)] underline"
              >
                Knowledge upload flow
              </Link>
              , then associate them here if needed.
            </p>
          </Card>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Code documents</h2>
        <Card>
          <CardTitle>Associated documents</CardTitle>
          <CardDescription>
            Knowledge entries tagged with this jurisdiction and a code document kind.
          </CardDescription>
          {docsForSelected.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--acton-muted)]">
              No code documents configured yet for{" "}
              {selectedJurisdiction?.name ?? "this jurisdiction"}.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--acton-border)]">
              {docsForSelected.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link
                      href={`/admin/knowledge/${doc.id}`}
                      className="font-medium text-[var(--acton-navy)] underline"
                    >
                      {doc.title}
                    </Link>
                    <p className="text-xs text-[var(--acton-muted)]">
                      {doc.doc_kind ?? "—"} · {doc.status}
                      {doc.source_url ? (
                        <>
                          {" · "}
                          <a
                            href={doc.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            Source
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void onClearAssociation(doc.id)}
                  >
                    Clear
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Associate existing knowledge entry</CardTitle>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => void onAssociate(e)}>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-[var(--acton-muted)]">Knowledge entry</span>
              <select
                className="w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2"
                value={entryId}
                onChange={(e) => setEntryId(e.target.value)}
              >
                <option value="">Select an entry…</option>
                {availableToAssociate.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                    {entry.jurisdiction_key ? ` (${entry.jurisdiction_key})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--acton-muted)]">Document kind</span>
              <select
                className="w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2"
                value={docKind}
                onChange={(e) => setDocKind(e.target.value as KnowledgeDocKind)}
              >
                {DOC_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={busy || !entryId}>
                Associate
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--acton-navy)]">Structured rules</h2>
        <Card>
          <CardTitle>{editingRuleId ? "Edit rule" : "Add rule"}</CardTitle>
          <CardDescription>
            Source citation is required (e.g. SJMC 20.30.150(b)). Rules without citations are
            refused.
          </CardDescription>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => void onSaveRule(e)}>
            <div className="space-y-2 sm:col-span-2">
              <span className="block text-sm text-[var(--acton-muted)]">Rule key</span>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={ruleKeyMode === "catalog"}
                    onChange={() => setRuleKeyMode("catalog")}
                  />
                  Catalog
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={ruleKeyMode === "custom"}
                    onChange={() => setRuleKeyMode("custom")}
                  />
                  Custom namespaced key
                </label>
              </div>
              {ruleKeyMode === "catalog" ? (
                <select
                  className="w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm"
                  value={ruleKey}
                  onChange={(e) => {
                    setRuleKey(e.target.value);
                    setQuantityUnit(defaultUnitForRuleKey(e.target.value) || "ft");
                  }}
                >
                  {(data.ruleKeyCatalog ?? JURISDICTION_RULE_KEY_CATALOG).map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={customRuleKey}
                  onChange={(e) => setCustomRuleKey(e.target.value)}
                  placeholder="e.g. adu_parking_spaces_min"
                />
              )}
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--acton-muted)]">Zone (optional)</span>
              <Input
                value={zoneKey}
                onChange={(e) => setZoneKey(e.target.value)}
                placeholder="e.g. R-1-8 — leave blank for jurisdiction-general"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[var(--acton-muted)]">Value</span>
              <div className="flex gap-2">
                <Input
                  value={quantityValue}
                  onChange={(e) => setQuantityValue(e.target.value)}
                  placeholder="150"
                  inputMode="decimal"
                />
                <Input
                  className="w-24"
                  value={quantityUnit}
                  onChange={(e) => setQuantityUnit(e.target.value)}
                  placeholder="ft"
                />
              </div>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-[var(--acton-muted)]">
                Source citation (required)
              </span>
              <Input
                value={sourceCitation}
                onChange={(e) => setSourceCitation(e.target.value)}
                placeholder="SJMC 20.30.150(b)"
                required
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-[var(--acton-muted)]">
                Linked knowledge entry (optional)
              </span>
              <select
                className="w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2"
                value={sourceEntryId}
                onChange={(e) => setSourceEntryId(e.target.value)}
              >
                <option value="">None</option>
                {docsForSelected.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-[var(--acton-muted)]">Notes</span>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {editingRuleId ? "Save changes" : "Add rule"}
              </Button>
              {editingRuleId ? (
                <Button type="button" variant="secondary" onClick={resetRuleForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <CardTitle>Rules for {selectedJurisdiction?.name ?? "…"}</CardTitle>
          {rulesForSelected.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--acton-muted)]">No structured rules yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--acton-border)]">
              {rulesForSelected.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-[var(--acton-navy)]">
                      {rule.rule_key}
                      {rule.zone_key ? (
                        <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">
                          zone {rule.zone_key}
                        </span>
                      ) : (
                        <span className="ml-2 text-xs font-normal text-[var(--acton-muted)]">
                          jurisdiction-general
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-[var(--acton-navy)]">
                      {formatValue(rule.value_json)} · cite: {rule.source_citation}
                    </p>
                    {rule.notes ? (
                      <p className="text-xs text-[var(--acton-muted)]">{rule.notes}</p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => startEditRule(rule)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void onDeleteRule(rule.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
