"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  FEEDBACK_RANGE_PRESET_LINKS,
  RECEIPT_LOG_PATH,
  buildReceiptLogHref,
  countActiveReceiptLogFilters,
  type ReceiptLogFiltersState,
} from "@/lib/receipts/log-filter-url";

export function ReceiptLogFiltersPanel({
  initial,
  userOptions,
  jobOptions,
  vendorOptions,
}: {
  initial: ReceiptLogFiltersState;
  userOptions: Array<{ id: string; label: string }>;
  jobOptions: Array<{ id: string; label: string }>;
  vendorOptions: string[];
}) {
  const activeCount = useMemo(() => countActiveReceiptLogFilters(initial), [initial]);
  const [open, setOpen] = useState(activeCount > 0);
  const [showCustomDates, setShowCustomDates] = useState(initial.range === "custom");
  const [userQuery, setUserQuery] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [vendorQuery, setVendorQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>(() => [...initial.userIds]);
  const [selectedJobs, setSelectedJobs] = useState<string[]>(() => [...initial.jobIds]);
  const [selectedVendors, setSelectedVendors] = useState<string[]>(() => [...initial.vendors]);

  const filteredUsers = userOptions.filter((u) =>
    u.label.toLowerCase().includes(userQuery.trim().toLowerCase()),
  );
  const filteredJobs = jobOptions.filter((j) =>
    j.label.toLowerCase().includes(jobQuery.trim().toLowerCase()),
  );
  const filteredVendors = vendorOptions.filter((v) =>
    v.toLowerCase().includes(vendorQuery.trim().toLowerCase()),
  );

  function toggle(list: string[], value: string, setter: (next: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Filters</CardTitle>
          <div className="flex items-center gap-2">
            {activeCount > 0 ? (
              <span className="rounded-full bg-[var(--acton-gray-100)] px-2 py-0.5 text-xs font-semibold text-[var(--acton-navy)]">
                {activeCount} active
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide filters" : "Filters"}
            </Button>
          </div>
        </div>

        {open ? (
          <form method="get" action={RECEIPT_LOG_PATH} className="mt-4 space-y-4">
            <input type="hidden" name="sort" value={initial.sort} />
            <input type="hidden" name="dir" value={initial.dir} />

            <div>
              <p className="mb-2 text-sm font-medium text-[var(--acton-navy)]">Date range</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {FEEDBACK_RANGE_PRESET_LINKS.map((preset) => (
                  <Link
                    key={preset.value}
                    href={buildReceiptLogHref({
                      ...initial,
                      range: preset.value,
                      customStart: "",
                      customEnd: "",
                      userIds: selectedUsers,
                      jobIds: selectedJobs,
                      vendors: selectedVendors,
                    })}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                      initial.range === preset.value
                        ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                        : "border-[var(--acton-border)] text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                    }`}
                  >
                    {preset.label}
                  </Link>
                ))}
                <button
                  type="button"
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                    initial.range === "custom"
                      ? "border-[var(--acton-navy)] bg-[var(--acton-navy)] text-white"
                      : "border-[var(--acton-border)] text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
                  }`}
                  onClick={() => {
                    setShowCustomDates(true);
                  }}
                >
                  Custom
                </button>
              </div>
              <input
                type="hidden"
                name="range"
                value={showCustomDates ? "custom" : initial.range}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-[var(--acton-navy)]">
                    Apply range to
                  </span>
                  <select
                    name="dateField"
                    defaultValue={initial.dateField}
                    className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                  >
                    <option value="logged">Date logged</option>
                    <option value="purchased">Date purchased</option>
                  </select>
                </label>
                {(showCustomDates || initial.range === "custom") && (
                  <>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-[var(--acton-navy)]">Start</span>
                      <input
                        type="date"
                        name="start"
                        defaultValue={initial.customStart}
                        className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-[var(--acton-navy)]">End</span>
                      <input
                        type="date"
                        name="end"
                        defaultValue={initial.customEnd}
                        className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                      />
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Entry type</span>
                <select
                  name="entryType"
                  defaultValue={initial.entryType}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                >
                  <option value="all">All</option>
                  <option value="photo">Has photo</option>
                  <option value="manual">Manual only</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Amount min</span>
                <input
                  name="amountMin"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={initial.amountMin}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">Amount max</span>
                <input
                  name="amountMax"
                  inputMode="decimal"
                  placeholder="1000.00"
                  defaultValue={initial.amountMax}
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                />
              </label>
              <label className="block text-sm md:col-span-2 lg:col-span-3">
                <span className="mb-1 block font-medium text-[var(--acton-navy)]">
                  Search vendor / items / description
                </span>
                <input
                  name="q"
                  defaultValue={initial.q}
                  placeholder="Search…"
                  className="h-10 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-[var(--acton-navy)]">
                  Submitting user
                </legend>
                <input
                  type="search"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Filter users"
                  className="mb-2 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
                />
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--acton-border)] p-2">
                  {filteredUsers.length === 0 ? (
                    <p className="text-xs text-[var(--acton-muted)]">No users</p>
                  ) : (
                    filteredUsers.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="user"
                          value={u.id}
                          checked={selectedUsers.includes(u.id)}
                          onChange={() => toggle(selectedUsers, u.id, setSelectedUsers)}
                        />
                        <span className="truncate">{u.label}</span>
                      </label>
                    ))
                  )}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-1 text-sm font-medium text-[var(--acton-navy)]">Job</legend>
                <input
                  type="search"
                  value={jobQuery}
                  onChange={(e) => setJobQuery(e.target.value)}
                  placeholder="Filter jobs"
                  className="mb-2 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
                />
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--acton-border)] p-2">
                  {filteredJobs.length === 0 ? (
                    <p className="text-xs text-[var(--acton-muted)]">No jobs</p>
                  ) : (
                    filteredJobs.map((j) => (
                      <label key={j.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="job"
                          value={j.id}
                          checked={selectedJobs.includes(j.id)}
                          onChange={() => toggle(selectedJobs, j.id, setSelectedJobs)}
                        />
                        <span className="truncate">{j.label}</span>
                      </label>
                    ))
                  )}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-1 text-sm font-medium text-[var(--acton-navy)]">
                  Vendor
                </legend>
                <input
                  type="search"
                  value={vendorQuery}
                  onChange={(e) => setVendorQuery(e.target.value)}
                  placeholder="Filter vendors"
                  className="mb-2 h-9 w-full rounded-md border border-[var(--acton-border)] bg-white px-2 text-sm"
                />
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-[var(--acton-border)] p-2">
                  {filteredVendors.length === 0 ? (
                    <p className="text-xs text-[var(--acton-muted)]">No vendors</p>
                  ) : (
                    filteredVendors.map((v) => (
                      <label key={v} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="vendor"
                          value={v}
                          checked={selectedVendors.includes(v)}
                          onChange={() => toggle(selectedVendors, v, setSelectedVendors)}
                        />
                        <span className="truncate">{v}</span>
                      </label>
                    ))
                  )}
                </div>
              </fieldset>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11">
                Apply filters
              </Button>
              <Link
                href={RECEIPT_LOG_PATH}
                className="inline-flex min-h-11 items-center rounded-md border border-[var(--acton-border)] px-4 text-sm font-medium text-[var(--acton-navy)]"
              >
                Reset
              </Link>
            </div>
          </form>
        ) : null}
      </Card>
    </div>
  );
}
