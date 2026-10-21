import { FileTextSummarySection } from "@footprint/ui";
import {
  DEFAULT_DISPLAY_SCENARIO,
  type DisplayScenario,
  type HistoryView,
} from "@footprint/contracts";
import {
  presentHistoryView,
  type HistorySummaryPresentation,
} from "../history-presentation";
export function HistoryDetails({
  history,
  scenario = DEFAULT_DISPLAY_SCENARIO,
}: {
  history: HistoryView;
  scenario?: DisplayScenario;
}) {
  const presentation = presentHistoryView(history, scenario);
  return (
    <section className="history-summary">
      <h2>Request coverage</h2>
      <a
        href="methodology.html#method-history"
        target="_blank"
        rel="noopener noreferrer"
      >
        Methodology
      </a>
      {presentation.serverNotice && <p>{presentation.serverNotice}</p>}
      {presentation.sections.map((section) => (
        <HistoryScope
          key={section.key}
          title={section.label}
          summary={section.summary}
          presentation={section.presentation}
        />
      ))}
    </section>
  );
}

function HistoryScope({
  title,
  summary,
  presentation,
}: {
  title: string;
  summary: HistoryView["local"];
  presentation: HistorySummaryPresentation;
}) {
  return (
    <article className="history-scope">
      <h3>{title}</h3>
      <p>
        First message:{" "}
        {summary.first_request_verified ? "Loaded" : "Not verified"}
      </p>
      {presentation.counts.length ? (
        <dl>
          {presentation.counts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <dl>
        {presentation.tokens.map((item) => (
          <div key={item.key}>
            <dt>{item.role}</dt>
            <dd>{item.tokens}</dd>
          </div>
        ))}
        {presentation.resources.map((item) => (
          <div key={item.key}>
            <dt>{item.quantity}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Measurement sources</summary>
        <dl>
          {presentation.tokens.map((item) => (
            <div key={item.key}>
              <dt>{item.role}</dt>
              <dd>
                {item.profile} · {item.evidence} · Unknown:{" "}
                {item.unknownMessages}
              </dd>
            </div>
          ))}
          {presentation.resources.map((item) => (
            <div key={item.key}>
              <dt>{item.quantity}</dt>
              <dd>
                {item.method} · {item.methodHash} · {item.selectedProfile} ·{" "}
                {item.status} · Unknown: {item.unknownMessages} · Missing:{" "}
                {item.missing}. {item.provenance}
              </dd>
            </div>
          ))}
        </dl>
        {summary.file_text.length > 0 && (
          <FileTextSummarySection
            fileText={summary.file_text}
            coverage={{
              observed_request_count:
                summary.file_text_coverage.observed_message_count,
              unknown_request_count:
                summary.file_text_coverage.unknown_message_count,
              scope: "extracted_file_text",
              additive: false,
            }}
            coverageLabel="Historical messages"
            headingLevel={4}
            className="history-file-text"
          />
        )}
      </details>
    </article>
  );
}
