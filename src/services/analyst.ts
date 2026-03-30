import { describeFreshness } from '@/services/persistent-cache';
import { isDesktopRuntime } from '@/services/runtime';
import { getMarketWatchlistEntries } from '@/services/market-watchlist';

export type AnalystMode = 'research' | 'decision';

export interface AnalystHealth {
  status?: string;
  ollama_host?: string;
  forecast_model?: string;
  critic_model?: string;
  warehouse_counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface AnalystPayload {
  [key: string]: unknown;
}

export interface AnalystOverview {
  available: boolean;
  baseUrl: string;
  fetchedAt: string;
  health: AnalystHealth | null;
  brief: AnalystPayload | null;
  error?: string;
}

const DEFAULT_ANALYST_BASE_URL = 'http://127.0.0.1:8181';
const HEALTH_CACHE_TTL_MS = 60_000;
const BRIEF_CACHE_TTL_MS = 5 * 60_000;

let cachedHealth: AnalystHealth | null = null;
let cachedHealthAt = 0;
let cachedBrief: AnalystPayload | null = null;
let cachedBriefAt = 0;

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '');
}

function isLocalHostRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname ?? '';
  return host === 'localhost' || host === '127.0.0.1';
}

export function getAnalystApiBaseUrl(): string {
  const envBase = import.meta.env.VITE_ANALYST_API_BASE_URL;
  if (typeof envBase === 'string' && envBase.trim().length > 0) {
    return normalizeBaseUrl(envBase.trim());
  }
  if (isDesktopRuntime() || isLocalHostRuntime()) {
    return DEFAULT_ANALYST_BASE_URL;
  }
  return '';
}

function getRequestUrl(path: string): string {
  const base = getAnalystApiBaseUrl();
  if (!base) {
    throw new Error('Local analyst service is unavailable in this runtime.');
  }
  return `${base}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(getRequestUrl(path), {
    ...init,
    headers,
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Analyst service returned HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

function shouldReuseCache(cachedAt: number, ttlMs: number, force: boolean): boolean {
  return !force && cachedAt > 0 && Date.now() - cachedAt < ttlMs;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getDefaultAnalystTicker(): string {
  const watchlistSymbol = getMarketWatchlistEntries()
    .map((entry) => entry.symbol?.trim().toUpperCase())
    .find((symbol) => !!symbol && !symbol.startsWith('^') && !symbol.includes('='));
  return watchlistSymbol || 'XOM';
}

export function getOverviewFreshnessLabel(overview: AnalystOverview | null): string {
  if (!overview) return 'Awaiting analyst service';
  const timestamp = getPayloadTimestamp(overview.brief) || overview.fetchedAt;
  return describeFreshness(new Date(timestamp).getTime());
}

export function getPayloadTimestamp(payload: AnalystPayload | null): string | null {
  if (!payload) return null;
  const candidates = [
    payload.generatedAt,
    payload.generated_at,
    payload.as_of,
    payload.asOf,
    payload.generated_at_utc,
  ];
  const match = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof match === 'string' ? match : null;
}

export async function fetchAnalystHealth(force = false): Promise<AnalystHealth | null> {
  if (cachedHealth && shouldReuseCache(cachedHealthAt, HEALTH_CACHE_TTL_MS, force)) {
    return cachedHealth;
  }
  const payload = await requestJson<AnalystHealth>('/api/analyst/v1/health', {
    method: 'GET',
  });
  cachedHealth = payload;
  cachedHealthAt = Date.now();
  return cachedHealth;
}

export async function fetchAnalystBrief(force = false, asOf = nowIso()): Promise<AnalystPayload | null> {
  if (cachedBrief && shouldReuseCache(cachedBriefAt, BRIEF_CACHE_TTL_MS, force)) {
    return cachedBrief;
  }
  const payload = await requestJson<AnalystPayload>('/api/analyst/v1/brief', {
    method: 'POST',
    body: JSON.stringify({ as_of: asOf }),
  });
  cachedBrief = payload;
  cachedBriefAt = Date.now();
  return cachedBrief;
}

export async function fetchAnalystOverview(force = false, asOf = nowIso()): Promise<AnalystOverview> {
  const baseUrl = getAnalystApiBaseUrl();
  if (!baseUrl) {
    return {
      available: false,
      baseUrl: '',
      fetchedAt: nowIso(),
      health: null,
      brief: null,
      error: 'Analyst panel is available only in local or desktop runtime.',
    };
  }

  const [healthResult, briefResult] = await Promise.allSettled([
    fetchAnalystHealth(force),
    fetchAnalystBrief(force, asOf),
  ]);

  const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
  const brief = briefResult.status === 'fulfilled' ? briefResult.value : null;
  const errors = [healthResult, briefResult]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => String(result.reason instanceof Error ? result.reason.message : result.reason));

  return {
    available: !!health && health.status === 'ok',
    baseUrl,
    fetchedAt: nowIso(),
    health,
    brief,
    error: errors[0],
  };
}

async function postAnalystMode(path: string, ticker: string, asOf = nowIso()): Promise<AnalystPayload> {
  return requestJson<AnalystPayload>(path, {
    method: 'POST',
    body: JSON.stringify({
      ticker: ticker.trim().toUpperCase(),
      as_of: asOf,
    }),
  });
}

export async function fetchAnalystResearch(ticker: string, asOf = nowIso()): Promise<AnalystPayload> {
  return postAnalystMode('/api/analyst/v1/research', ticker, asOf);
}

export async function fetchAnalystForecast(ticker: string, asOf = nowIso()): Promise<AnalystPayload> {
  return postAnalystMode('/api/analyst/v1/forecast', ticker, asOf);
}
