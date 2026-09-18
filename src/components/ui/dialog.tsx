"use client";

/**
 * Accessible dialog primitive — hand-rolled to keep Baxter dependency-light.
 * Handles focus trap, Escape, backdrop dismiss, scroll lock, and focus restore.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type DialogContextValue = {
  titleId: string;
  descriptionId: string;
  onClose: () => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error("Dialog components must be used within <Dialog>");
  return ctx;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isDisplayed(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
  // Prefer computed style: `offsetParent` is null for fixed/sticky ancestors and in jsdom.
  try {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
  } catch {
    /* ignore — treat as visible in non-DOM environments */
  }
  return true;
}

function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && isDisplayed(el),
  );
}

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Called when the user tries to dismiss (Escape / backdrop). Return false to block. */
  onRequestClose?: () => boolean | void;
  className?: string;
  /** Larger content area for editor forms. */
  size?: "md" | "lg";
};

export function Dialog({
  open,
  onClose,
  children,
  onRequestClose,
  className,
  size = "md",
}: DialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const canPortal = typeof document !== "undefined";

  const requestClose = React.useCallback(() => {
    if (onRequestClose) {
      const allowed = onRequestClose();
      if (allowed === false) return;
    }
    onClose();
  }, [onClose, onRequestClose]);

  // Always call the latest dismiss handler from the keydown listener without
  // tying focus/scroll setup to unstable callback identities.
  const requestCloseRef = React.useRef(requestClose);
  React.useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  // Open/close lifecycle only: initial focus, scroll lock, focus restore.
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = panel ? getFocusable(panel) : [];
    const first = focusables[0] ?? panel;
    const focusTimer = window.setTimeout(() => first?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Keydown: Escape + focus trap. Reads requestClose via ref so unstable
  // onClose/onRequestClose props do not re-run open lifecycle work.
  React.useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const nodes = getFocusable(panelRef.current);
      if (!nodes.length) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const firstNode = nodes[0]!;
      const lastNode = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!canPortal || !open) return null;

  return createPortal(
    <DialogContext.Provider value={{ titleId, descriptionId, onClose: requestClose }}>
      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
        <button
          type="button"
          aria-label="Close dialog"
          className="absolute inset-0 bg-[var(--acton-navy)]/40"
          onClick={requestClose}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className={cn(
            "relative z-10 flex max-h-[min(92vh,880px)] w-full flex-col overflow-hidden rounded-t-xl border border-[var(--acton-border)] bg-white shadow-lg sm:rounded-xl",
            size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg",
            className,
          )}
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  );
}

export function DialogHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("shrink-0 border-b border-[var(--acton-border)] px-4 py-3 sm:px-5", className)}
    >
      {children}
    </div>
  );
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { titleId } = useDialogContext();
  return (
    <h2 id={titleId} className={cn("text-base font-semibold text-[var(--acton-navy)]", className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { descriptionId } = useDialogContext();
  return (
    <p id={descriptionId} className={cn("mt-1 text-sm text-[var(--acton-muted)]", className)}>
      {children}
    </p>
  );
}

export function DialogBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5", className)}>
      {children}
    </div>
  );
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--acton-border)] bg-[var(--acton-gray-50)] px-4 py-3 sm:px-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function DialogCloseButton({
  className,
  label = "Cancel",
}: {
  className?: string;
  label?: string;
}) {
  const { onClose } = useDialogContext();
  return (
    <Button
      type="button"
      variant="secondary"
      className={cn("min-h-11", className)}
      onClick={onClose}
    >
      {label}
    </Button>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for deletes. */
  destructive?: boolean;
  busy?: boolean;
  /**
   * When set, the confirm button stays disabled until the user types this
   * exact string (e.g. "DELETE") into the confirmation field.
   */
  requireTypedPhrase?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  requireTypedPhrase,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} size="md">
      {/* Remount on open so typed-phrase state resets without render-time setState. */}
      {open ? (
        <ConfirmDialogBody
          key="confirm-open"
          onClose={onClose}
          onConfirm={onConfirm}
          title={title}
          description={description}
          confirmLabel={confirmLabel}
          cancelLabel={cancelLabel}
          destructive={destructive}
          busy={busy}
          requireTypedPhrase={requireTypedPhrase}
        />
      ) : null}
    </Dialog>
  );
}

function ConfirmDialogBody({
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  requireTypedPhrase,
}: Omit<ConfirmDialogProps, "open">) {
  const [typed, setTyped] = React.useState("");
  const phraseOk = !requireTypedPhrase || typed.trim() === requireTypedPhrase;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {requireTypedPhrase ? (
        <DialogBody>
          <label
            className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
            htmlFor="confirm-typed-phrase"
          >
            Type <span className="font-mono font-semibold">{requireTypedPhrase}</span> to confirm
          </label>
          <input
            id="confirm-typed-phrase"
            className="min-h-11 w-full rounded-md border border-[var(--acton-border)] px-3 text-base text-[var(--acton-navy)]"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </DialogBody>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={busy}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? "danger" : "primary"}
          className="min-h-11"
          disabled={busy || !phraseOk}
          onClick={() => {
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
