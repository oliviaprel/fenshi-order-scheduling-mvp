"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ModalDialog({
  labelledBy,
  onDismiss,
  dismissible = true,
  role = "dialog",
  children,
}: Readonly<{
  labelledBy: string;
  onDismiss: () => void;
  dismissible?: boolean;
  role?: "dialog" | "alertdialog";
  children: React.ReactNode;
}>) {
  const dialogRef = useRef<HTMLElement>(null);
  const dismissRef = useRef(onDismiss);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    dismissRef.current = onDismiss;
    dismissibleRef.current = dismissible;
  }, [dismissible, onDismiss]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    const initialFocus = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (initialFocus ?? dialog)?.focus();

    return () => {
      previouslyFocused?.focus();
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (dismissibleRef.current) dismissRef.current();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (dialog === null) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;

    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="admin-dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>
  );
}
