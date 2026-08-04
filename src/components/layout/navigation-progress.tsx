"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin top-of-viewport progress bar that appears as soon as an in-app nav link
 * is clicked, and clears when the destination route finishes rendering.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  const [active, setActive] = useState(false);
  const [routeWhenActivated, setRouteWhenActivated] = useState(routeKey);

  // Reset when the completed navigation updates the route (render-time adjust).
  if (active && routeKey !== routeWhenActivated) {
    setActive(false);
    setRouteWhenActivated(routeKey);
  }

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        const next = `${url.pathname}${url.search}`;
        const current = `${window.location.pathname}${window.location.search}`;
        if (next === current) return;
      } catch {
        return;
      }
      setRouteWhenActivated(routeKey);
      setActive(true);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [routeKey]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
      aria-hidden={!active}
      data-testid="navigation-progress"
      data-active={active ? "true" : "false"}
    >
      <div
        className={
          active
            ? "h-full w-full origin-left animate-[nav-progress_1.2s_ease-in-out_infinite] bg-[var(--acton-navy)]"
            : "h-full w-0 bg-transparent"
        }
      />
    </div>
  );
}
