"use client";

/* eslint-disable @next/next/no-img-element -- renderings are served from storage/CDN at full size */

/**
 * Visual building blocks of the customer configurator. Class names, colors and sizes follow
 * the existing design.actonadu.com UI so the rebuilt page looks the same.
 */

import { useEffect, useState, type ReactNode } from "react";

export const LOGO_SRC = "/configurator/ActonADU.svg";

export function SiteHeader({ homeUrl, onSave }: { homeUrl: string; onSave: () => void }) {
  return (
    <div className="mb-0 flex items-center justify-between px-4 py-2 md:mb-6 md:px-0 md:py-0">
      <a href={homeUrl} className="group relative block h-6 w-[150px]" aria-label="Back to home">
        <img
          src={LOGO_SRC}
          alt="Acton ADU"
          width={150}
          height={24}
          className="absolute inset-0 opacity-100 transition-opacity duration-300 group-hover:opacity-0"
        />
        <span className="absolute inset-0 flex text-[#000000] opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          ← Back to home
        </span>
      </a>
      <button
        type="button"
        onClick={onSave}
        className="cursor-pointer rounded-full bg-[#00263E] px-[16px] py-[6px] text-[12px] leading-[150%] text-white hover:opacity-90 md:text-[16px]"
      >
        Save
      </button>
    </div>
  );
}

const CARD_BASE =
  "w-full rounded-[10px] px-[12px] py-[10px] text-left transition-colors duration-200 md:px-[20px] md:py-[18px] flex items-center justify-between gap-4 border text-[#2E2A22]";
const SELECTED = "border-[#0088FF80] bg-[#0088FF26]";
const UNSELECTED = "border-[#E5E5E4] bg-white";

export function OptionList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="no-scrollbar flex flex-col gap-[8px] pb-20 md:max-h-[350px] md:overflow-y-auto 2xl:max-h-[600px] 2xl:pb-0"
    >
      {children}
    </div>
  );
}

export function OptionCard({
  label,
  selected,
  onSelect,
  right,
  testId,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  right?: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onSelect}
      className={`${CARD_BASE} ${selected ? SELECTED : UNSELECTED} cursor-pointer`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-[16px] md:text-base">{label}</span>
        <div className="flex items-center gap-3">{right}</div>
      </div>
    </button>
  );
}

export function PriceTag({ text }: { text: string | null }) {
  if (!text) return null;
  return <span className="font-medium text-[#A6A5A5]">{text}</span>;
}

/** Appliance / upgrade card with bullet lines. */
export function FeatureCard({
  title,
  lines,
  priceText,
  selected,
  onSelect,
  testId,
}: {
  title: string;
  lines: string[];
  priceText: string | null;
  selected: boolean;
  onSelect: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid={testId}
      onClick={onSelect}
      className={`w-full cursor-pointer rounded-[10px] border px-4 py-[10px] text-left transition-colors duration-200 md:py-[18px] ${selected ? SELECTED : UNSELECTED}`}
    >
      <div className="flex items-start justify-between gap-4">
        <span className="text-sm text-black md:text-[16px]">{title}</span>
        {priceText ? (
          <span className="shrink-0 pt-0.5 text-sm text-[#A6A5A5]">{priceText}</span>
        ) : null}
      </div>
      {lines.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[10px] text-[#6A6A6A] md:text-[12px]">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </button>
  );
}

export function Switch({
  on,
  disabled,
  label,
  onToggle,
  testId,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
  testId?: string;
}) {
  const color = disabled ? "#9CA3AF" : on ? "#0088FF" : "#6A6A6A";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={disabled}
      data-testid={testId}
      onClick={() => !disabled && onToggle()}
      className={`flex items-center gap-2 select-none md:gap-3 ${disabled ? "cursor-default opacity-60" : "cursor-pointer"}`}
    >
      <span
        className="relative inline-flex h-[24px] w-[45px] items-center rounded-[2rem] border md:h-[30px] md:w-[60px]"
        style={{ borderColor: color }}
      >
        <span
          className={`ml-[1px] inline-block h-[20px] w-[20px] rounded-full transition-transform duration-300 md:h-[26px] md:w-[26px] ${on ? "translate-x-5 md:translate-x-7" : ""}`}
          style={{ backgroundColor: color }}
        />
      </span>
      <span className="text-xs text-[#6A6A6A] md:text-sm">{label}</span>
    </button>
  );
}

export function ToggleBar({ children, raised }: { children: ReactNode; raised?: boolean }) {
  return (
    <div className="-mx-[10px] md:mx-0">
      <div
        className={`relative ${raised ? "z-[999]" : "z-10"} flex h-[30px] w-full max-w-full items-center justify-end gap-2 rounded-none bg-gray-200 px-7 py-6 backdrop-blur-[12px] md:h-[55px] md:gap-8 md:px-9 md:py-4 md:backdrop-blur-[48px]`}
      >
        {children}
      </div>
    </div>
  );
}

/** Left column: blurred backdrop + contained rendering (desktop), cropped image (mobile). */
export function RenderView({
  src,
  alt,
  testId,
  onClick,
  zoomable,
}: {
  src: string | null;
  alt: string;
  testId?: string;
  onClick?: () => void;
  zoomable?: boolean;
}) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setWide(img.naturalWidth / Math.max(1, img.naturalHeight) > 1.3);
    img.src = src;
  }, [src]);
  const url = src ? `url("${src}")` : undefined;
  return (
    <div
      className={`relative w-full overflow-hidden md:flex-1 ${zoomable ? "cursor-zoom-in md:cursor-default" : ""}`}
      data-testid={testId}
      data-src={src ?? ""}
      onClick={onClick}
    >
      <div className="relative block overflow-hidden md:hidden">
        {src ? (
          <img
            src={src}
            alt={alt}
            className={`h-auto max-h-[200px] w-full object-contain ${wide ? "scale-110" : "scale-[1.6]"}`}
          />
        ) : (
          <div className="h-[200px] w-full bg-gray-100" />
        )}
      </div>
      <div className="absolute inset-0 hidden h-full w-full md:block">
        <div
          className="absolute inset-0 bg-cover bg-center blur-[30px] transition-opacity duration-200"
          style={{
            backgroundImage: url,
            backgroundSize: wide ? "120%" : "160%",
            scale: wide ? 1.3 : 1,
          }}
        />
        <div className="absolute inset-0 bg-black/20" />
        <div
          role="img"
          aria-label={alt}
          className="absolute inset-0 bg-center bg-no-repeat transition-transform duration-200"
          style={{ backgroundImage: url, backgroundSize: "contain", scale: wide ? 1 : 1.4 }}
        />
      </div>
    </div>
  );
}

/** One full-screen step: rendering on the left (70%), panel on the right (30%). */
export function StepLayout({
  section,
  header,
  image,
  toggles,
  children,
}: {
  section: string;
  header: ReactNode;
  image: ReactNode;
  toggles?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-h-screen snap-start snap-always" data-section={section}>
      <div className="flex flex-col md:h-screen md:flex-row">
        <div className="md:hidden">{header}</div>
        <div
          className="flex w-full flex-col overflow-hidden md:h-screen"
          style={{ flexBasis: "70%" }}
        >
          {image}
          {toggles ? <div className="w-full">{toggles}</div> : null}
        </div>
        <div
          className="no-scrollbar relative z-20 flex w-full flex-col justify-start bg-white px-[10px] pt-0 sm:pb-0 md:max-h-screen md:overflow-y-auto md:px-[20px] md:pt-[20px]"
          style={{ flexBasis: "30%" }}
        >
          <div className="hidden md:block">{header}</div>
          <div className="mt-1 md:mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

export function Modal({
  open,
  onClose,
  children,
  labelledBy,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div
      className={`fixed inset-0 z-[2000] items-center justify-center bg-black/30 ${open ? "flex" : "hidden"}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative max-h-[95vh] w-full ${wide ? "max-w-xl" : "max-w-md"} overflow-y-auto rounded-lg bg-white p-6 shadow-lg`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2 right-3 z-10 text-xl leading-none text-gray-400 hover:text-gray-700"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function PreApprovedPill({ title, cities }: { title: string; cities: string[] }) {
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      <span className="inline-flex items-center gap-1 rounded-full bg-[#4CAF50] px-2.5 py-1 text-[12px] font-medium text-white">
        Pre-approved
        <span className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white text-[10px]">
          i
        </span>
      </span>
      <span className="pointer-events-none absolute top-full right-0 z-20 mt-2 w-[200px] rounded-xl bg-[#5F5F5F] px-4 py-3 text-left text-[14px] leading-5 text-white opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <p className="mb-2 break-words">{title}</p>
        <ul className="space-y-0.5">
          {cities.map((c) => (
            <li key={c}>- {c}</li>
          ))}
        </ul>
      </span>
    </span>
  );
}

export function ScrollHint({ visible }: { visible: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed bottom-24 left-1/2 z-[1100] -translate-x-1/2 animate-bounce transition-opacity md:hidden ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <svg
        className="h-8 w-8 text-gray-700 opacity-80"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );
}
