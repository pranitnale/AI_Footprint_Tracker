import React, {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ElementType,
  type ReactNode,
} from "react";
import { formatInteger as formatIntegerValue } from "./formatters";
import {
  fileTextOriginLabel,
  fileTextProfileLabel,
  presentFileTextSummary,
  readableFileTextCode,
  type ExtractedFileTextComponent,
  type FileTextCoverage,
  type FileTextSeries,
} from "./file-text";

export {
  formatDateTime,
  formatDecimal,
  formatInteger,
  formatMetric,
  formatRetention,
  type KnownValue,
} from "./formatters";
export {
  presentFileTextSummary,
  type ExtractedFileTextComponent,
  type FileTextCoverage,
  type FileTextSeries,
} from "./file-text";

function SectionHeading({
  level,
  children,
}: {
  level: 2 | 3 | 4;
  children: ReactNode;
}) {
  const Heading = `h${level}` as ElementType;
  return <Heading>{children}</Heading>;
}

export function FileTextSummarySection({
  fileText,
  coverage,
  coverageLabel = "Requests",
  headingLevel = 2,
  className = "file-text-summary",
}: {
  fileText?: FileTextSeries[] | null;
  coverage?: FileTextCoverage | null;
  coverageLabel?: "Requests" | "Historical messages";
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const presentation = presentFileTextSummary(fileText, coverage);
  return (
    <section className={className}>
      <SectionHeading level={headingLevel}>{presentation.title}</SectionHeading>
      <p>{presentation.description}</p>
      {presentation.coverage ? (
        <dl>
          <div>
            <dt>{coverageLabel} with observed extraction state</dt>
            <dd>{presentation.coverage.observedRequests}</dd>
          </div>
          <div>
            <dt>{coverageLabel} with unknown extraction state</dt>
            <dd>{presentation.coverage.unknownRequests}</dd>
          </div>
        </dl>
      ) : (
        <p>{presentation.coverageUnknown}</p>
      )}
      {presentation.empty ? <p>{presentation.empty}</p> : null}
      {presentation.groups.length ? (
        <div className="file-text-groups">
          {presentation.groups.map((item) => (
            <article className="file-text-group" key={item.key}>
              <h3>
                <span>{item.profile}</span> · <span>{item.origin}</span>
              </h3>
              <p>
                <strong>{item.tokens}</strong>
              </p>
              <dl>
                <div>
                  <dt>Extraction profile</dt>
                  <dd>{item.extractionProfileId}</dd>
                </div>
                <div>
                  <dt>Tokenizer profile</dt>
                  <dd>{item.tokenizerProfile}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{item.evidence}</dd>
                </div>
                <div>
                  <dt>Applicable components</dt>
                  <dd>{item.applicable}</dd>
                </div>
                <div>
                  <dt>Contributing components</dt>
                  <dd>{item.contributing}</dd>
                </div>
                <div>
                  <dt>Unknown</dt>
                  <dd>{item.unknown}</dd>
                </div>
                <div>
                  <dt>Partial</dt>
                  <dd>{item.partial}</dd>
                </div>
                <div>
                  <dt>Unvalidated</dt>
                  <dd>{item.unvalidated}</dd>
                </div>
              </dl>
              <p>Measurement reasons: {item.reasons}.</p>
              <p>Missing coverage: {item.missing}.</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ExtractedFileTextDetails({
  extractedText,
  schemaVersion,
  headingLevel = 4,
}: {
  extractedText?: ExtractedFileTextComponent[] | null;
  schemaVersion?: string | null;
  headingLevel?: 2 | 3 | 4;
}) {
  return (
    <section className="file-text-details">
      <SectionHeading level={headingLevel}>Extracted file text</SectionHeading>
      <p>
        This records file text observed inline or extracted locally. It does not
        establish original file fidelity, rendered visibility, provider OCR,
        retrieval or processing and is not a calibrated provider count.
      </p>
      <p>Record schema version: {schemaVersion ?? "Unknown"}.</p>
      {!Array.isArray(extractedText) ? (
        <p>
          Document text extraction is unknown. This record may predate the
          extraction field or the file may not have been accessible.
        </p>
      ) : extractedText.length === 0 ? (
        <p>
          No extracted document-text components were observed for this request.
          This does not establish zero provider document processing.
        </p>
      ) : (
        <div className="file-text-components">
          {extractedText.map((component) => (
            <article
              className="file-text-component"
              key={component.component_id}
            >
              <h5>
                <span>
                  {fileTextProfileLabel(component.extraction_profile_id)}
                </span>{" "}
                · <span>{fileTextOriginLabel(component.origin)}</span>
              </h5>
              <dl>
                <div>
                  <dt>Extracted-file tokens</dt>
                  <dd>{formatIntegerValue(component.tokens.value)}</dd>
                </div>
                <div>
                  <dt>Pages observed</dt>
                  <dd>{formatIntegerValue(component.page_count)}</dd>
                </div>
                <div>
                  <dt>Extraction profile</dt>
                  <dd>{component.extraction_profile_id}</dd>
                </div>
                <div>
                  <dt>Tokenizer profile</dt>
                  <dd>{component.tokens.profile_id ?? "Unknown"}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>
                    {component.tokens.evidence === "heuristic_estimate"
                      ? "Heuristic local estimate"
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Completeness</dt>
                  <dd>{readableFileTextCode(component.tokens.completeness)}</dd>
                </div>
                <div>
                  <dt>Measurement reason</dt>
                  <dd>
                    {component.tokens.reason
                      ? readableFileTextCode(component.tokens.reason)
                      : "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Missing coverage</dt>
                  <dd>
                    {component.missing.map(readableFileTextCode).join(", ")}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function ResourceGauge({
  className = "",
  ...props
}: HTMLAttributes<SVGElement>) {
  const decorative =
    props["aria-hidden"] === true || props["aria-hidden"] === "true";
  return (
    <svg
      {...props}
      className={`resource-gauge ${className}`.trim()}
      viewBox="0 0 64 64"
      aria-label={decorative ? undefined : "AI Footprint Tracker"}
      role={decorative ? undefined : "img"}
      focusable="false"
    >
      <path
        d="M27 6 A27 27 0 0 0 21 57 M37 6 A27 27 0 0 1 43 57"
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
      />
      <path
        d="M23 42 C18 28 30 20 43 17 C42 29 37 43 25 42 L22 47 Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <ResourceGauge aria-hidden="true" />
      <span>AI Footprint{compact ? " " : <br />}Tracker</span>
    </span>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
}) {
  return (
    <button
      {...props}
      className={`button button-${variant} ${className}`.trim()}
    />
  );
}

export function Status({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function Notice({
  tone = "neutral",
  title,
  children,
  role,
}: {
  tone?: "neutral" | "warning" | "danger";
  title?: string;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Dialog({
  title,
  children,
  actions,
  onClose,
  dangerous = false,
  size = "default",
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  dangerous?: boolean;
  size?: "default" | "wide";
}) {
  const ref = useRef<HTMLElement>(null);
  const prior = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    prior.current = document.activeElement as HTMLElement;
    ref.current
      ?.querySelector<HTMLElement>("button,input,select,textarea,a[href]")
      ?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !ref.current) return;
      const items = [
        ...ref.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ),
      ];
      if (!items.length) return;
      const first = items[0]!,
        last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      prior.current?.focus();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        data-dangerous={dangerous || undefined}
        data-size={size}
      >
        <div className="dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <Button variant="quiet" onClick={onClose} aria-label="Close dialog">
            Close
          </Button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">{actions}</div>
      </section>
    </div>
  );
}
