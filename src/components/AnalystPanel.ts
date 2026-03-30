import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import {
  fetchAnalystForecast,
  fetchAnalystOverview,
  fetchAnalystResearch,
  getDefaultAnalystTicker,
  getOverviewFreshnessLabel,
  getPayloadTimestamp,
  type AnalystMode,
  type AnalystOverview,
  type AnalystPayload,
} from '@/services/analyst';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isRecord(item)) {
        const summary = item.summary ?? item.chain ?? item.hypothesis ?? item.trigger ?? item.reason;
        return typeof summary === 'string' ? summary : JSON.stringify(item);
      }
      return String(item);
    })
    .filter((item) => item.trim().length > 0);
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) <= 1) return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return `${(value * 100).toFixed(0)}%`;
}

function renderListBlock(title: string, items: string[], emptyLabel = 'None surfaced'): string {
  return `
    <div style="display:grid;gap:6px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">${escapeHtml(title)}</div>
      ${
        items.length > 0
          ? `<ul style="margin:0;padding-left:18px;display:grid;gap:6px;font-size:12px;line-height:1.45">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
          : `<div style="font-size:12px;color:var(--text-dim)">${escapeHtml(emptyLabel)}</div>`
      }
    </div>
  `;
}

function renderKeyValueCards(items: Array<{ label: string; value: string }>): string {
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
      ${items.map((item) => `
        <div style="padding:10px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">${escapeHtml(item.label)}</div>
          <div style="margin-top:4px;font-size:13px;font-weight:600">${escapeHtml(item.value)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function summarizeCausalValue(value: unknown): string {
  if (!isRecord(value)) return typeof value === 'string' ? value : 'N/A';
  const baseValue = value.value;
  const status = typeof value.status === 'string' ? value.status : '';
  const renderedValue = typeof baseValue === 'number'
    ? formatNumber(baseValue)
    : typeof baseValue === 'string'
      ? baseValue
      : JSON.stringify(baseValue ?? {});
  return status ? `${renderedValue} (${status.replace(/_/g, ' ')})` : renderedValue;
}

function renderEvidenceIds(layer: Record<string, unknown>): string {
  const evidenceIds = normalizeList(layer.evidence_ids);
  if (evidenceIds.length === 0) return '';
  return `
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${evidenceIds.map((item) => `
        <span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:10px;font-family:var(--font-mono);color:var(--text-dim)">${escapeHtml(item)}</span>
      `).join('')}
    </div>
  `;
}

function renderLayerCard(title: string, layerValue: unknown): string {
  const layer = asRecord(layerValue);
  const summary = typeof layer.summary === 'string'
    ? layer.summary
    : typeof layer.pricing_summary === 'string'
      ? layer.pricing_summary
      : typeof layer.reason === 'string'
        ? layer.reason
        : '';

  const secondaryLists: string[] = [];
  const activeChains = normalizeList(layer.active_chains);
  if (activeChains.length > 0) secondaryLists.push(renderListBlock('Active Chains', activeChains, 'No chains surfaced'));
  const triggers = normalizeList(layer.triggers);
  if (triggers.length > 0) secondaryLists.push(renderListBlock('Triggers', triggers));
  const unknowns = normalizeList(layer.unknowns);
  if (unknowns.length > 0) secondaryLists.push(renderListBlock('Unknowns', unknowns));
  const missingEvidence = normalizeList(layer.missing_evidence);
  if (missingEvidence.length > 0) secondaryLists.push(renderListBlock('Missing Evidence', missingEvidence));
  const keyRisks = normalizeList(layer.key_risks);
  if (keyRisks.length > 0) secondaryLists.push(renderListBlock('Key Risks', keyRisks));

  return `
    <section style="display:grid;gap:8px;padding:12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">${escapeHtml(title)}</div>
        ${renderEvidenceIds(layer)}
      </div>
      <div style="font-size:12px;line-height:1.55;color:var(--text)">${escapeHtml(summary || 'No layer summary returned.')}</div>
      ${secondaryLists.join('')}
    </section>
  `;
}

function extractBriefSummary(brief: AnalystPayload | null): string {
  if (!brief) return 'No nightly brief available yet.';
  const candidates = [
    brief.summary,
    brief.executive_summary,
    brief.market_summary,
    brief.title,
  ];
  const match = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof match === 'string' ? match : 'Structured brief is available below for inspection.';
}

function extractBriefRows(brief: AnalystPayload | null): Array<Record<string, unknown>> {
  if (!brief) return [];
  const candidateKeys = ['rows', 'ranked_rows', 'leaders', 'top_picks', 'recommendations', 'items'];
  for (const key of candidateKeys) {
    const value = brief[key];
    if (Array.isArray(value)) {
      return value.filter((item) => isRecord(item)).slice(0, 5) as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function renderBriefRows(brief: AnalystPayload | null): string {
  const rows = extractBriefRows(brief);
  if (rows.length === 0) {
    return '<div style="font-size:12px;color:var(--text-dim)">No ranked brief rows were returned in the latest report.</div>';
  }
  return `
    <div style="display:grid;gap:8px">
      ${rows.map((row) => {
        const label = String(row.ticker ?? row.symbol ?? row.name ?? row.label ?? 'Idea');
        const subtitle = String(row.sector ?? row.theme ?? row.rationale ?? '');
        const scoreValue = row.score ?? row.conviction ?? row.rank ?? row.weight;
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
            <div>
              <div style="font-size:12px;font-weight:600">${escapeHtml(label)}</div>
              <div style="font-size:11px;color:var(--text-dim)">${escapeHtml(subtitle || 'Latest ranked idea')}</div>
            </div>
            <div style="font-size:12px;font-family:var(--font-mono);color:var(--text-dim)">${escapeHtml(typeof scoreValue === 'number' ? formatNumber(scoreValue) : String(scoreValue ?? ''))}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderBriefSection(overview: AnalystOverview | null): string {
  const brief = overview?.brief ?? null;
  const generatedAt = formatTimestamp(getPayloadTimestamp(brief));
  return `
    <section style="display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.03)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="font-size:13px;font-weight:600">Latest backend brief</div>
        <div style="font-size:11px;color:var(--text-dim)">${escapeHtml(generatedAt)}</div>
      </div>
      <div style="font-size:12px;line-height:1.55;color:var(--text)">${escapeHtml(extractBriefSummary(brief))}</div>
      ${renderBriefRows(brief)}
    </section>
  `;
}

function renderOverviewCards(overview: AnalystOverview | null): string {
  const health = overview?.health ?? {};
  const counts = asRecord(health.warehouse_counts);
  return renderKeyValueCards([
    { label: 'Service', value: String(health.status ?? 'offline') },
    { label: 'Forecast model', value: String(health.forecast_model ?? 'N/A') },
    { label: 'Critic model', value: String(health.critic_model ?? 'N/A') },
    { label: 'Prices', value: formatNumber(counts.prices) },
    { label: 'Events', value: formatNumber(counts.events) },
    { label: 'Causal states', value: formatNumber(counts.causal_state) },
  ]);
}

function renderConfidenceBreakdown(result: AnalystPayload): string {
  const confidence = asRecord(result.confidence_breakdown);
  if (Object.keys(confidence).length === 0) return '';
  const cards = [
    { label: 'Data', value: formatPercent(asRecord(confidence.data_confidence).value) },
    { label: 'State', value: formatPercent(asRecord(confidence.state_confidence).value) },
    { label: 'Model', value: formatPercent(asRecord(confidence.model_confidence).value) },
    { label: 'Pricing', value: formatPercent(asRecord(confidence.pricing_confidence).value) },
    { label: 'Analog', value: formatPercent(asRecord(confidence.analog_confidence).value) },
    { label: 'Decision', value: formatPercent(confidence.decision_confidence) },
  ];
  const caps = normalizeList(confidence.cap_reasons);
  return `
    <section style="display:grid;gap:10px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">Confidence Breakdown</div>
      ${renderKeyValueCards(cards)}
      ${caps.length > 0 ? renderListBlock('Confidence caps', caps) : ''}
    </section>
  `;
}

function renderHorizonVerdicts(result: AnalystPayload): string {
  const rows = Array.isArray(result.horizon_verdicts) ? result.horizon_verdicts : [];
  if (rows.length === 0) return '';
  return `
    <section style="display:grid;gap:8px">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">Horizon View</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
        ${rows.map((row) => {
          const item = asRecord(row);
          return `
            <div style="padding:10px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
              <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">${escapeHtml(String(item.horizon ?? 'horizon'))}</div>
              <div style="margin-top:4px;font-size:13px;font-weight:600">${escapeHtml(String(item.verdict ?? 'research_only'))}</div>
              <div style="margin-top:4px;font-size:11px;color:var(--text-dim)">${escapeHtml(formatPercent(item.confidence))}</div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderCriticSection(result: AnalystPayload): string {
  const critic = asRecord(result.critic ?? result.critic_outcome);
  if (Object.keys(critic).length === 0) return '';
  const reasonCodes = normalizeList(critic.critic_reason_codes);
  const missingEvidence = normalizeList(critic.missing_evidence);
  return `
    <section style="display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">Critic / Governance</div>
        <div style="font-size:12px;font-weight:600">${escapeHtml(critic.critic_veto ? 'Veto / downgrade' : 'No veto')}</div>
      </div>
      ${renderKeyValueCards([
        { label: 'Forced mode', value: String(critic.forced_mode_change ?? 'none') },
        { label: 'Adjustment', value: typeof critic.confidence_adjustment === 'number' ? critic.confidence_adjustment.toFixed(2) : '0.00' },
      ])}
      ${reasonCodes.length > 0 ? renderListBlock('Reason codes', reasonCodes) : ''}
      ${missingEvidence.length > 0 ? renderListBlock('Missing evidence', missingEvidence) : ''}
    </section>
  `;
}

function renderRawJson(result: AnalystPayload): string {
  return `
    <details style="border:1px solid var(--border);border-radius:4px;padding:10px 12px;background:rgba(255,255,255,0.02)">
      <summary style="cursor:pointer;font-size:12px;font-weight:600">Raw analyst JSON</summary>
      <pre style="margin:10px 0 0;font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;color:var(--text-dim)">${escapeHtml(JSON.stringify(result, null, 2))}</pre>
    </details>
  `;
}

export class AnalystPanel extends Panel {
  private ticker = getDefaultAnalystTicker();
  private overview: AnalystOverview | null = null;
  private result: AnalystPayload | null = null;
  private resultMode: 'research' | 'forecast' | null = null;
  private errorMessage: string | null = null;
  private runningMode: AnalystMode | null = null;
  private overviewSource: 'live' | 'cached' = 'live';

  constructor() {
    super({
      id: 'analyst',
      title: 'Local Analyst',
      className: 'panel-wide',
      defaultRowSpan: 2,
      infoTooltip: 'Structured local analyst that reads the backend ContextPack, separates facts from pricing, and downgrades to research-only when actionability is weak.',
    });

    this.content.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-analyst-action]');
      if (!target) return;
      const action = target.dataset.analystAction;
      if (action === 'refresh') {
        void this.refreshOverview(true);
        return;
      }
      if (action === 'research') {
        void this.runMode('research');
        return;
      }
      if (action === 'forecast') {
        void this.runMode('decision');
      }
    });

    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (target?.dataset.analystInput !== 'ticker') return;
      this.ticker = target.value.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12);
    });

    this.content.addEventListener('keydown', (event) => {
      const target = event.target as HTMLInputElement;
      if (target?.dataset.analystInput !== 'ticker') return;
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.runMode('research');
      }
    });

    this.render();
  }

  public renderOverview(overview: AnalystOverview, source: 'live' | 'cached' = 'live'): void {
    this.overview = overview;
    this.overviewSource = source;
    this.errorMessage = overview.error || null;
    this.applyBadge();
    this.render();
  }

  public showUnavailable(message = 'Local analyst service is unavailable. Start the finance analyst backend and refresh this panel.'): void {
    this.overview = {
      available: false,
      baseUrl: '',
      fetchedAt: new Date().toISOString(),
      health: null,
      brief: null,
      error: message,
    };
    this.errorMessage = message;
    this.setDataBadge('unavailable', 'service offline');
    this.render();
  }

  private applyBadge(): void {
    if (!this.overview?.available) {
      this.setDataBadge('unavailable', 'service offline');
      return;
    }
    this.setDataBadge(this.overviewSource, getOverviewFreshnessLabel(this.overview));
  }

  private async refreshOverview(force = false): Promise<void> {
    this.runningMode = null;
    this.errorMessage = null;
    this.render();
    try {
      const overview = await fetchAnalystOverview(force);
      this.renderOverview(overview, force ? 'live' : 'cached');
    } catch (error) {
      this.showUnavailable(error instanceof Error ? error.message : 'Failed to reach the local analyst service.');
    }
  }

  private async runMode(mode: AnalystMode): Promise<void> {
    const ticker = this.ticker.trim().toUpperCase();
    if (!ticker) {
      this.errorMessage = 'Enter a ticker before running the analyst.';
      this.render();
      return;
    }
    this.runningMode = mode;
    this.errorMessage = null;
    this.render();
    try {
      const payload = mode === 'research'
        ? await fetchAnalystResearch(ticker)
        : await fetchAnalystForecast(ticker);
      this.result = payload;
      this.resultMode = mode === 'research' ? 'research' : 'forecast';
      this.runningMode = null;
      this.render();
    } catch (error) {
      this.runningMode = null;
      this.errorMessage = error instanceof Error ? error.message : 'The analyst request failed.';
      this.render();
    }
  }

  private renderResultSection(): string {
    if (!this.result) {
      return `
        <section style="padding:12px;border:1px dashed var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
          <div style="font-size:12px;color:var(--text-dim);line-height:1.55">
            Run <strong>Research</strong> to inspect the local ContextPack and causal layers, or run <strong>Forecast</strong> to see whether the trust gate keeps the setup actionable or downgrades it to research-only.
          </div>
        </section>
      `;
    }

    const decisionLayer = asRecord(this.result.decision_layer);
    const pricingLayer = asRecord(this.result.pricing_layer);
    const headerCards = [
      { label: 'Requested', value: String(this.result.requested_mode ?? this.resultMode ?? 'research') },
      { label: 'Resolved', value: String(this.result.resolved_mode ?? decisionLayer.mode ?? 'research_only') },
      { label: 'Trust tier', value: String(this.result.trust_tier ?? 'experimental') },
      { label: 'Conviction', value: formatPercent(this.result.conviction ?? asRecord(this.result.confidence_breakdown).decision_confidence) },
      { label: 'Downgrade', value: String(this.result.downgrade_reason_category ?? 'none') },
    ];

    const modeBanner = decisionLayer.mode === 'research_only'
      ? 'Decision-quality action was not approved. Treat this as research-only.'
      : 'Decision mode remained allowed under the current trust gate.';

    const pricingCards = renderKeyValueCards([
      { label: 'Cross-asset', value: summarizeCausalValue(asRecord(pricingLayer.cross_asset_confirmation).aggregate_confirmation) },
      { label: 'Market confirmation', value: summarizeCausalValue(asRecord(pricingLayer.pricing_discipline).market_confirmation) },
      { label: 'Trade readiness', value: summarizeCausalValue(asRecord(pricingLayer.trade_readiness).summary) },
      { label: 'Pricing disagreement', value: summarizeCausalValue(asRecord(pricingLayer.pricing_disagreement).divergence_score) },
    ]);

    return `
      <section style="display:grid;gap:12px">
        <div style="padding:12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.03)">
          <div style="font-size:13px;font-weight:600">${escapeHtml(String(this.result.ticker ?? this.ticker))}</div>
          <div style="margin-top:6px;font-size:12px;color:var(--text-dim);line-height:1.55">${escapeHtml(modeBanner)}</div>
          <div style="margin-top:10px">${renderKeyValueCards(headerCards)}</div>
        </div>
        ${renderHorizonVerdicts(this.result)}
        <section style="display:grid;gap:8px">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">Pricing controls</div>
          ${pricingCards}
        </section>
        ${renderConfidenceBreakdown(this.result)}
        ${renderLayerCard('Fact Layer', this.result.fact_layer)}
        ${renderLayerCard('Interpretation Layer', this.result.interpretation_layer)}
        ${renderLayerCard('Pricing Layer', this.result.pricing_layer)}
        ${renderLayerCard('Decision Layer', this.result.decision_layer)}
        ${renderLayerCard('Falsification Layer', this.result.falsification_layer)}
        ${renderCriticSection(this.result)}
        ${renderRawJson(this.result)}
      </section>
    `;
  }

  private render(): void {
    const baseUrl = this.overview?.baseUrl || 'http://127.0.0.1:8181';
    const runningResearch = this.runningMode === 'research';
    const runningForecast = this.runningMode === 'decision';
    const errorHtml = this.errorMessage
      ? `<div style="padding:10px 12px;border:1px solid color-mix(in srgb,var(--yellow) 35%,transparent);border-radius:4px;background:color-mix(in srgb,var(--yellow) 8%,transparent);font-size:12px;line-height:1.5;color:var(--text)">${escapeHtml(this.errorMessage)}</div>`
      : '';

    const html = `
      <div style="display:grid;gap:12px">
        <section style="display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.03)">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div>
              <div style="font-size:13px;font-weight:600">Local analyst control room</div>
              <div style="margin-top:4px;font-size:12px;line-height:1.55;color:var(--text-dim)">
                This panel talks to the local finance backend, reads its ContextPack, and shows whether the setup survives pricing, trust-tier, and critic checks.
              </div>
            </div>
            <button
              type="button"
              data-analyst-action="refresh"
              style="border:1px solid var(--border);background:rgba(255,255,255,0.02);color:var(--text);padding:8px 10px;border-radius:4px;font-size:12px;cursor:pointer"
            >
              Refresh
            </button>
          </div>
          ${renderOverviewCards(this.overview)}
          <div style="font-size:11px;color:var(--text-dim)">
            Endpoint: <span style="font-family:var(--font-mono)">${escapeHtml(baseUrl)}</span>
          </div>
        </section>

        ${errorHtml}

        <section style="display:grid;gap:10px;padding:12px;border:1px solid var(--border);border-radius:4px;background:rgba(255,255,255,0.02)">
          <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)">Run analyst</div>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px">
            <input
              type="text"
              value="${escapeHtml(this.ticker)}"
              data-analyst-input="ticker"
              placeholder="Ticker"
              style="min-width:0;border:1px solid var(--border);border-radius:4px;background:rgba(0,0,0,0.15);color:var(--text);padding:10px 12px;font-size:13px;font-family:var(--font-mono)"
            />
            <button
              type="button"
              data-analyst-action="research"
              ${runningResearch ? 'disabled' : ''}
              style="border:1px solid var(--border);background:rgba(255,255,255,0.03);color:var(--text);padding:10px 12px;border-radius:4px;font-size:12px;cursor:pointer"
            >
              ${runningResearch ? 'Running...' : 'Research'}
            </button>
            <button
              type="button"
              data-analyst-action="forecast"
              ${runningForecast ? 'disabled' : ''}
              style="border:1px solid var(--border);background:rgba(255,255,255,0.03);color:var(--text);padding:10px 12px;border-radius:4px;font-size:12px;cursor:pointer"
            >
              ${runningForecast ? 'Running...' : 'Forecast'}
            </button>
          </div>
          <div style="font-size:11px;color:var(--text-dim);line-height:1.5">
            Use <strong>Research</strong> for chains, analogs, and missing evidence. Use <strong>Forecast</strong> to see whether the backend keeps the idea actionable or downgrades it to <span style="font-family:var(--font-mono)">research_only</span>.
          </div>
        </section>

        ${renderBriefSection(this.overview)}

        ${this.renderResultSection()}
      </div>
    `;

    this.setContent(html);
  }
}
