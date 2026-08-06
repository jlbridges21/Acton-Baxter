"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { ReportNavItem, ReportSectionId } from "@/lib/research/report-view-model";

/**
 * In-page report navigation: sticky sidebar on desktop, sticky select on mobile.
 * Screen-only — print renders the plain card stack.
 */
export function ReportSectionNav({ sections }: { sections: ReportNavItem[] }) {
  const [activeId, setActiveId] = useState<ReportSectionId | null>(sections[0]?.id ?? null);
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const order = sections.map((section) => section.id);
    const elements = order
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const visible = visibleRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const topmost = order.find((id) => visible.has(id));
        if (topmost) setActiveId(topmost);
      },
      // Ignore the band under the app header and the bottom half of the viewport so
      // the highlighted item matches what the reader is actually looking at.
      { rootMargin: "-96px 0px -55% 0px", threshold: 0 },
    );

    for (const element of elements) observer.observe(element);
    return () => {
      observer.disconnect();
      visible.clear();
    };
  }, [sections]);

  const jumpTo = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id as ReportSectionId);
  }, []);

  if (sections.length === 0) return null;

  return (
    <div className="lg:sticky lg:top-6 lg:self-start print:hidden">
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-[var(--acton-border)] bg-[var(--acton-gray-50)]/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
        <label
          htmlFor="report-section-jump"
          className="text-xs font-semibold tracking-wide text-[var(--acton-muted)] uppercase"
        >
          Jump to section
        </label>
        <select
          id="report-section-jump"
          className="mt-1.5 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--acton-navy)]"
          value={activeId ?? sections[0]!.id}
          onChange={(event) => jumpTo(event.target.value)}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.navLabel}
            </option>
          ))}
        </select>
      </div>

      <nav aria-label="Report sections" className="hidden lg:block">
        <p className="px-3 text-xs font-semibold tracking-[0.14em] text-[var(--acton-muted)] uppercase">
          On this report
        </p>
        <ul className="mt-2 space-y-0.5">
          {sections.map((section) => {
            const isActive = section.id === activeId;
            return (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={isActive ? "true" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    jumpTo(section.id);
                  }}
                  className={cn(
                    "block rounded-md border-l-2 py-1.5 pr-2 pl-3 text-sm transition-colors",
                    isActive
                      ? "border-[var(--acton-yellow)] bg-white font-semibold text-[var(--acton-navy)]"
                      : "border-transparent text-[var(--acton-muted)] hover:bg-white hover:text-[var(--acton-navy)]",
                  )}
                >
                  {section.navLabel}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
