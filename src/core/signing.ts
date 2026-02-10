/**
 * HMAC Signing implementations for various exchanges/APIs
 */

import { createHmac } from 'crypto';

export interface SigningResult {
  headers: Record<string, string>;
  urlParams?: Record<string, string>;
}

export interface BybitSigningParams {
  apiKey: string;
  apiSecret: string;
  method: string;
  queryString: string;
  body?: string;
  timestamp?: string;
  recvWindow?: string;
}

export interface OKXSigningParams {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  method: string;
  requestPath: string;
  body?: string;
  timestamp?: string;
}

export interface MEXCSigningParams {
  apiKey: string;
  apiSecret: string;
  queryString: string;
  timestamp?: string;
}

// Note: MEXCSigningParams is used for generic 'hmac' auth type
// (query-string signing pattern used by MEXC and similar exchanges)

/**
 * Bybit HMAC signing
 * - GET/DELETE: sign timestamp + apiKey + recvWindow + queryString
 * - POST/PUT: sign timestamp + apiKey + recvWindow + body
 */
export function signBybit(params: BybitSigningParams): SigningResult {
  const timestamp = params.timestamp || Date.now().toString();
  const recvWindow = params.recvWindow || '5000';
  const method = params.method.toUpperCase();
  
  // POST/PUT sign the body, GET/DELETE sign the query string
  const payloadData = (method === 'POST' || method === 'PUT') 
    ? (params.body || '')
    : params.queryString;
  
  const signPayload = timestamp + params.apiKey + recvWindow + payloadData;
  const signature = createHmac('sha256', params.apiSecret)
    .update(signPayload)
    .digest('hex');
  
  return {
    headers: {
      'X-BAPI-API-KEY': params.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-SIGN': signature,
      'X-BAPI-RECV-WINDOW': recvWindow
    }
  };
}

/**
 * OKX HMAC signing
 * - Always signs: timestamp + method + requestPath + body
 * - Uses base64 encoding
 */
export function signOKX(params: OKXSigningParams): SigningResult {
  const timestamp = params.timestamp || new Date().toISOString();
  const method = params.method.toUpperCase();
  const body = params.body || '';
  
  const signPayload = timestamp + method + params.requestPath + body;
  const signature = createHmac('sha256', params.apiSecret)
    .update(signPayload)
    .digest('base64');
  
  return {
    headers: {
      'OK-ACCESS-KEY': params.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': params.passphrase
    }
  };
}

/**
 * Generic HMAC signing (MEXC-style)
 * - Signs query string with timestamp
 * - Returns signature as URL param and API key as header
 * - Used by MEXC and other exchanges with similar auth schemes
 */
export function signMEXC(params: MEXCSigningParams): SigningResult {
  const timestamp = params.timestamp || Date.now().toString();
  
  // Add timestamp to query string for signing
  const queryWithTimestamp = params.queryString 
    ? `${params.queryString}&timestamp=${timestamp}`
    : `timestamp=${timestamp}`;
  
  const signature = createHmac('sha256', params.apiSecret)
    .update(queryWithTimestamp)
    .digest('hex');
  
  return {
    headers: {
      'X-MEXC-APIKEY': params.apiKey
    },
    urlParams: {
      timestamp,
      signature
    }
  };
}
