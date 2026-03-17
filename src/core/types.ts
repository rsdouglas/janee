export const DEFAULT_TIMEOUT_MS = 30_000;
export const REDACTED = '[REDACTED]';
export const MIN_SCRUB_LENGTH = 8;

const TTL_PATTERN = /^(\d+)(s|m|h|d)$/;
const TTL_MULTIPLIERS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

/** Validate a TTL string format (e.g. "30s", "5m", "1h", "7d"). Throws on invalid input. */
export function validateTTL(ttl: string): void {
  if (!TTL_PATTERN.test(ttl)) {
    throw new Error(`Invalid TTL "${ttl}" — expected format like 30s, 5m, 1h, 7d`);
  }
}

/** Parse a TTL string into seconds. Throws on invalid input. */
export function parseTTL(ttl: string): number {
  const match = ttl.match(TTL_PATTERN);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const [, num, unit] = match;
  return parseInt(num) * TTL_MULTIPLIERS[unit];
}

export interface APIRequest {
  service: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface APIResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

export type DenialReasonCode =
  | 'CAPABILITY_NOT_FOUND'
  | 'AGENT_NOT_ALLOWED'
  | 'DEFAULT_ACCESS_RESTRICTED'
  | 'OWNERSHIP_DENIED'
  | 'RULE_DENY'
  | 'MODE_MISMATCH'
  | 'REASON_REQUIRED'
  | 'COMMAND_NOT_ALLOWED';

export interface DenialDetails {
  reasonCode: DenialReasonCode;
  capability?: string;
  agentId?: string | null;
  evaluatedPolicy?: string;
  nextStep: string;
}

export class DenialError extends Error {
  denial: DenialDetails;
  constructor(message: string, denial: DenialDetails) {
    super(message);
    this.name = 'DenialError';
    this.denial = denial;
  }
}
