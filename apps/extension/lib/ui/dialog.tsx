import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "@footprint/ui/icons";

const FOCUSABLE = "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex='0']";

/**
 * Living Gauge confirmation dialog (canvas Dialog* boards). Keeps focus inside while open, closes on
 * Escape or a backdrop click unless `busy`, and returns focus to the control that opened it.
 */
export function LgDialog({
  title,
  icon,
  tone = "neutral",
  children,
  actions,
  onClose,
  busy = false,
  dark = false,
  wide = false,
}: {
  title: string;
  icon?: IconName;
  tone?: "neutral" | "warn" | "danger" | "ok";
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  busy?: boolean;
  dark?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) close.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const firstItem = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      prior?.focus?.();
    };
  }, []);

  return (
    <div className="lg-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`lg-dialog${dark ? " lg-dialog-dark" : ""}${wide ? " lg-dialog-wide" : ""}`}>
        {icon && (
          <span className={`lg-dialog-icon lg-dialog-icon-${tone}`} aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
        )}
        <h2 id={titleId} className="lg-display">
          {title}
        </h2>
        <div className="lg-dialog-body">{children}</div>
        <div className="lg-dialog-actions">{actions}</div>
      </section>
    </div>
  );
}

/** One line of a dialog's consequence list, with a check, a cross or a note icon. */
export function DialogPoint({ kind, children }: { kind: "yes" | "no" | "note"; children: ReactNode }) {
  return (
    <li className={`lg-point lg-point-${kind}`}>
      <Icon name={kind === "yes" ? "check" : kind === "no" ? "close" : "refresh"} size={15} />
      <span>{children}</span>
    </li>
  );
}

/** Short confirmation that fades after a few seconds (canvas MenusSheet notifications). */
export function Toast({ children, onDone }: { children: ReactNode; onDone: () => void }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const timer = window.setTimeout(() => done.current(), 5_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="lg-toast" role="status" aria-live="polite">
      <span className="lg-toast-icon" aria-hidden="true">
        <Icon name="check" size={14} />
      </span>
      <span>{children}</span>
    </div>
  );
}
