"use client";

import { useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AnimatedAgentSpec, Cue, OfficeDirector } from "./director";

/**
 * Static desk drawn in the same canvas space as the desk sprites (275×236 for Baxter V3),
 * so it lines up with the desk inside the sit/work frames. Shown while the character is
 * away from the desk; hidden while the sprite (which includes its own desk) plays.
 */
export function DeskArt() {
  return (
    <svg viewBox="0 0 275 236" className="h-full w-full" aria-hidden>
      {/* chair */}
      <rect x="66" y="78" width="40" height="70" rx="8" fill="#2c2e35" />
      <rect x="62" y="140" width="52" height="14" rx="4" fill="#3a3c44" />
      <rect x="85" y="154" width="6" height="56" fill="#2c2e35" />
      <path d="M64 214h60" stroke="#2c2e35" strokeWidth="7" strokeLinecap="round" />
      <circle cx="66" cy="222" r="6" fill="#1f2026" />
      <circle cx="122" cy="222" r="6" fill="#1f2026" />
      {/* legs (U-frames) */}
      <path d="M80 160v66h34v-66" fill="none" stroke="#3a3b41" strokeWidth="8" />
      <path d="M208 160v66h38v-66" fill="none" stroke="#3a3b41" strokeWidth="8" />
      {/* tabletop */}
      <path d="M72 147h194l-3 9H75z" fill="#d6a064" />
      <rect x="75" y="156" width="188" height="9" fill="#b97a40" />
      {/* plant */}
      <rect x="104" y="134" width="20" height="16" fill="#efe9de" />
      <circle cx="108" cy="128" r="7" fill="#3f8f3a" />
      <circle cx="119" cy="126" r="7" fill="#4ca346" />
      <circle cx="114" cy="119" r="7" fill="#57b04c" />
      {/* laptop */}
      <path d="M160 104l82-3-4 43-80 3z" fill="#a5a7ae" />
      <path d="M150 147l92-3 6 6-98 3z" fill="#7f828a" />
      <rect x="194" y="118" width="10" height="8" fill="#c9cbd1" />
      {/* mug */}
      <rect x="236" y="134" width="20" height="20" rx="2" fill="#2f63c9" />
      <path d="M256 139h4a4 4 0 0 1 0 10h-4" fill="none" stroke="#2f63c9" strokeWidth="3" />
    </svg>
  );
}

export function AnimatedAgent({
  spec,
  director,
  name,
  ariaLabel,
  selected,
  onSelect,
  bubble,
  cue,
}: {
  spec: AnimatedAgentSpec;
  director: OfficeDirector;
  name: string;
  ariaLabel: string;
  selected: boolean;
  onSelect: () => void;
  bubble: ReactNode;
  cue: Cue | undefined;
}) {
  const s = spec.pack.scale;
  const charCanvas = spec.manifest.canvases.character;
  const deskCanvas = spec.manifest.canvases.desk;
  const idle0 = spec.manifest.animations.idle?.frames[0];
  const work0 = spec.manifest.animations.working?.frames[0];

  const rootRef = useCallback(
    (el: HTMLButtonElement | null) => director.bind(spec.id, { root: el }),
    [director, spec.id],
  );
  const charRef = useCallback(
    (el: HTMLImageElement | null) => director.bind(spec.id, { charImg: el }),
    [director, spec.id],
  );
  const deskRef = useCallback(
    (el: HTMLImageElement | null) => director.bind(spec.id, { deskImg: el }),
    [director, spec.id],
  );
  const propRef = useCallback(
    (el: HTMLSpanElement | null) => director.bind(spec.id, { deskProp: el }),
    [director, spec.id],
  );

  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: spec.desk.origin.x,
          top: spec.desk.origin.y,
          width: deskCanvas.width * s,
          height: deskCanvas.height * s,
          zIndex: Math.round(spec.desk.frontY),
        }}
      >
        <span ref={propRef} className="ai-office-fade absolute inset-0">
          <DeskArt />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element -- frames are swapped imperatively */}
        <img
          ref={deskRef}
          src={work0}
          alt=""
          draggable={false}
          className="ai-office-sprite ai-office-fade absolute inset-0 h-full w-full"
          style={{ opacity: 0 }}
        />
      </span>
      <button
        ref={rootRef}
        type="button"
        onClick={onSelect}
        onPointerDown={(e) => e.stopPropagation()}
        aria-pressed={selected}
        aria-label={ariaLabel}
        className="group ai-office-actor absolute top-0 left-0 focus-visible:outline-none"
        style={{ transform: `translate3d(${spec.desk.stand.x}px, ${spec.desk.stand.y}px, 0)` }}
      >
        {/* floor shadow + selection ring */}
        <span
          aria-hidden
          className={cn(
            "ai-office-shadow absolute block rounded-[50%]",
            selected
              ? "ring-4 ring-[var(--acton-yellow)]"
              : "group-focus-visible:ring-4 group-focus-visible:ring-[var(--acton-yellow)]",
          )}
          style={{ left: -24, top: -6, width: 48, height: 12, background: "rgba(43,33,24,0.22)" }}
        />
        {/* hit box over the body */}
        <span
          aria-hidden
          className="absolute block"
          style={{ left: -26, top: -64, width: 52, height: 64 }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- frames are swapped imperatively */}
        <img
          ref={charRef}
          src={idle0}
          alt=""
          draggable={false}
          className="ai-office-sprite ai-office-fade pointer-events-none absolute max-w-none"
          style={{
            left: -charCanvas.anchor.x * s,
            top: -charCanvas.anchor.y * s,
            width: charCanvas.width * s,
            height: charCanvas.height * s,
            opacity: 0,
          }}
        />
        <span className="absolute left-0 block w-0" style={{ top: -66 }}>
          {bubble}
        </span>
        {cue?.caption ? (
          <span
            className={cn(
              "ai-office-caption absolute left-0 block -translate-x-1/2 border-2 border-[#2b2118] px-2 py-0.5 text-[11px] leading-tight font-bold whitespace-nowrap",
              cue.tone === "error"
                ? "bg-red-600 text-white"
                : cue.tone === "success"
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-[#2b2118]",
            )}
            style={{ top: -122, boxShadow: "2px 2px 0 #2b2118" }}
          >
            {cue.caption}
          </span>
        ) : null}
        <span
          className="absolute left-0 block -translate-x-1/2 border-2 border-[#2b2118] px-1.5 py-px text-[11px] leading-tight font-bold whitespace-nowrap text-[#2b2118]"
          style={{ top: 8, background: "var(--office-label-bg)" }}
        >
          {name}
        </span>
      </button>
    </>
  );
}
