import { canonicalJson } from "@footprint/contracts";
import type { ApplicationRepository, Scope } from "@footprint/ledger";
import type { CompanySession } from "./company";
import type { EngineService } from "./estimation/service";
import { scanSummary } from "./summary-scan";
import { buildUsageFilters } from "./ui-model";

interface Authority {
  scope: Scope;
  token: string;
  current(): Promise<void>;
}

/** A monthly claim is written only for the exact completed calculation being returned. */
export class MonthlySummaryService {
  constructor(
    private repository: ApplicationRepository,
    private company: Pick<CompanySession, "credentials">,
    private engines: Pick<EngineService, "view">,
    private authority: () => Promise<Authority>,
    private serverQuery: (query: string) => Promise<Record<string, unknown>>,
  ) {}

  async read(now = new Date()) {
    for (let retry = 0; retry < 3; retry++) {
      try {
        const authority = await this.authority();
        const { scope } = authority;
        const selection = await this.engines.view(scope);
        if (selection.pending) return null;
        const credentials =
          scope.mode === "company"
            ? await this.company.credentials()
            : undefined;
        if (
          scope.mode === "company" &&
          (!credentials ||
            credentials.namespace !== scope.namespace ||
            credentials.enrollment_era.id !== scope.era)
        )
          throw new Error("policy_unavailable");
        const timezone =
          credentials?.policy.timezone ??
          (await this.repository.readSettings())?.timezone;
        if (!timezone) throw new Error("policy_unavailable");
        const filters = buildUsageFilters(
          {
            period: "last_month",
            start: "",
            end: "",
            site: "",
            model: "",
            calculationView: selection.view,
            methodId: selection.method?.method_id ?? "",
          },
          timezone,
          now,
          "my",
        );
        const month = filters.startDate.slice(0, 7);
        const previous = await this.repository.lastClaimedMonth(
          scope.namespace,
        );
        if (previous && previous >= month) return null;
        const summary = credentials
          ? await this.serverQuery(filters.query)
          : await scanSummary(
              this.repository,
              scope.namespace,
              filters.local,
              undefined,
              false,
              undefined,
              selection.method
                ? (attempt, _original, request, context) =>
                    selection.scanEstimate(request, attempt, context)
                : undefined,
              undefined,
              {
                originalUnused: true,
                resultMethodHash: selection.method?.method_hash,
              },
            );
        if (
          credentials &&
          (!("aggregate_status" in summary) ||
            summary.aggregate_status !== "current")
        )
          return null;
        await authority.current();
        await selection.current();
        if (
          canonicalJson(selection.guard.authorityScope) !== canonicalJson(scope)
        )
          throw new Error("policy_unavailable");
        const claimed = await this.repository.claimMonthlyView({
          scope,
          month,
          timezone,
          selection: selection.guard,
          company: credentials
            ? {
                deviceId: credentials.device_id,
                deletionEpoch: credentials.policy.deletion_epoch,
              }
            : null,
        });
        if (claimed === "stale") continue;
        if (claimed === "already_claimed") return null;
        const calculation = {
          view: selection.view,
          methodId: selection.method?.method_id ?? null,
          methodHash: selection.method?.method_hash ?? null,
          pending: false,
        };
        return {
          month,
          timezone,
          summary: { ...summary, scopeToken: authority.token, calculation },
          calculation,
          generatedAt: Date.now(),
        };
      } catch (error) {
        if (
          !(error instanceof Error) ||
          ![
            "aggregate_inconsistent",
            "selection_conflict",
            "policy_unavailable",
          ].includes(error.message) ||
          retry === 2
        )
          throw error;
      }
    }
    throw new Error("aggregate_inconsistent");
  }
}
