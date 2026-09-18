/**
 * @vitest-environment jsdom
 *
 * Dialog focus regression: unstable onClose/onRequestClose must not steal focus
 * back to the first field on each keystroke.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

/** Parent that recreates dismiss callbacks every render (the bug repro). */
function UnstableCallbackDialog({
  open = true,
  onClose = () => undefined,
}: {
  open?: boolean;
  onClose?: () => void;
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [notes, setNotes] = useState("");
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  return (
    <Dialog
      open={open}
      onClose={() => {
        bump();
        onClose();
      }}
      onRequestClose={() => {
        bump();
      }}
    >
      <DialogHeader>
        <DialogTitle>Focus trap form</DialogTitle>
        <DialogDescription>Typing must stay in the active field.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <label htmlFor="dlg-first">
          Title
          <input
            id="dlg-first"
            value={first}
            onChange={(e) => {
              setFirst(e.target.value);
              bump();
            }}
          />
        </label>
        <label htmlFor="dlg-second">
          Sub-question
          <input
            id="dlg-second"
            value={second}
            onChange={(e) => {
              setSecond(e.target.value);
              bump();
            }}
          />
        </label>
        <label htmlFor="dlg-notes">
          Guide notes
          <textarea
            id="dlg-notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              bump();
            }}
          />
        </label>
      </DialogBody>
      <DialogFooter>
        <button type="button">Save</button>
      </DialogFooter>
    </Dialog>
  );
}

describe("Dialog focus stability with unstable dismiss callbacks", () => {
  it("keeps focus and accumulates text in a non-first input across keystrokes", async () => {
    render(<UnstableCallbackDialog />);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/^Title$/i));
    });

    const second = screen.getByLabelText(/^Sub-question$/i) as HTMLInputElement;
    second.focus();
    expect(document.activeElement).toBe(second);

    const typed = "Access barriers?";
    let value = "";
    for (const ch of typed) {
      value += ch;
      fireEvent.change(second, { target: { value } });
      // Allow the (buggy) open-lifecycle setTimeout(0) focus steal to run if present.
      await new Promise((r) => setTimeout(r, 0));
      expect(document.activeElement).toBe(second);
      expect(second.value).toBe(value);
    }
    expect(second.value).toBe(typed);
    expect(document.activeElement).toBe(second);
  });

  it("keeps focus in guide notes (textarea) across keystrokes", async () => {
    render(<UnstableCallbackDialog />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    const notes = screen.getByLabelText(/Guide notes/i) as HTMLTextAreaElement;
    notes.focus();
    const typed = "Check footing";
    let value = "";
    for (const ch of typed) {
      value += ch;
      fireEvent.change(notes, { target: { value } });
      await new Promise((r) => setTimeout(r, 0));
      expect(document.activeElement).toBe(notes);
    }
    expect(notes.value).toBe(typed);
  });
});

describe("Dialog primitive a11y", () => {
  it("focuses the first focusable on open and restores focus on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open";
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Restore</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <button type="button">First action</button>
          <button type="button">Second</button>
        </DialogBody>
      </Dialog>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /First action/i }));
    });
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <Dialog open={false} onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Restore</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <button type="button">First action</button>
        </DialogBody>
      </Dialog>,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
      expect(document.body.style.overflow).not.toBe("hidden");
    });
    trigger.remove();
  });

  it("traps Tab within the dialog", async () => {
    render(
      <Dialog open onClose={() => undefined}>
        <DialogHeader>
          <DialogTitle>Tab trap</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <button type="button">Alpha</button>
          <button type="button">Beta</button>
        </DialogBody>
      </Dialog>,
    );

    const alpha = screen.getByRole("button", { name: /^Alpha$/i });
    const beta = screen.getByRole("button", { name: /^Beta$/i });
    await waitFor(() => expect(document.activeElement).toBe(alpha));

    beta.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(alpha);

    alpha.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(beta);
  });

  it("exposes dialog role, aria-modal, labelled title, and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Test dialog</DialogTitle>
          <DialogDescription>Helper text</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <button type="button">Inside</button>
        </DialogBody>
        <DialogFooter>
          <button type="button">OK</button>
        </DialogFooter>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("Test dialog")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <DialogHeader>
          <DialogTitle>Backdrop</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogHeader>
        <DialogBody>Body</DialogBody>
      </Dialog>,
    );
    fireEvent.click(screen.getByLabelText("Close dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("honors onRequestClose returning false", () => {
    const onClose = vi.fn();
    const onRequestClose = vi.fn(() => false);
    render(
      <Dialog open onClose={onClose} onRequestClose={onRequestClose}>
        <DialogHeader>
          <DialogTitle>Blocked</DialogTitle>
          <DialogDescription>Desc</DialogDescription>
        </DialogHeader>
        <DialogBody>Body</DialogBody>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onRequestClose).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
