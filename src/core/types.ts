export const DEFAULT_TIMEOUT_MS = 30_000;
export const REDACTED = '[REDACTED]';
export const MIN_SCRUB_LENGTH = 8;

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
