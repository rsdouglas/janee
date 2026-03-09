/**
 * Tests for HMAC signing implementations
 */

import { createHmac } from 'crypto';
import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  signBybit,
  signMEXC,
  signOKX,
  signTwitterOAuth1a,
} from './signing';

describe('signBybit', () => {
  const apiKey = 'test-api-key';
  const apiSecret = 'test-api-secret';
  const timestamp = '1700000000000';
  const recvWindow = '5000';

  it('should sign GET request with query string', () => {
    const result = signBybit({
      apiKey,
      apiSecret,
      method: 'GET',
      queryString: 'symbol=BTCUSDT&category=spot',
      timestamp,
      recvWindow
    });

    // Verify headers are set
    expect(result.headers['X-BAPI-API-KEY']).toBe(apiKey);
    expect(result.headers['X-BAPI-TIMESTAMP']).toBe(timestamp);
    expect(result.headers['X-BAPI-RECV-WINDOW']).toBe(recvWindow);
    expect(result.headers['X-BAPI-SIGN']).toBeDefined();

    // Verify signature is correct (GET uses query string)
    const expectedPayload = timestamp + apiKey + recvWindow + 'symbol=BTCUSDT&category=spot';
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.headers['X-BAPI-SIGN']).toBe(expectedSig);
  });

  it('should sign POST request with body (not query string)', () => {
    const body = '{"symbol":"BTCUSDT","side":"Buy","orderType":"Limit","qty":"0.01","price":"50000"}';
    
    const result = signBybit({
      apiKey,
      apiSecret,
      method: 'POST',
      queryString: 'should=be-ignored',
      body,
      timestamp,
      recvWindow
    });

    // Verify signature uses body, not query string
    const expectedPayload = timestamp + apiKey + recvWindow + body;
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.headers['X-BAPI-SIGN']).toBe(expectedSig);

    // Verify it does NOT use query string
    const wrongPayload = timestamp + apiKey + recvWindow + 'should=be-ignored';
    const wrongSig = createHmac('sha256', apiSecret).update(wrongPayload).digest('hex');
    expect(result.headers['X-BAPI-SIGN']).not.toBe(wrongSig);
  });

  it('should sign PUT request with body', () => {
    const body = '{"orderId":"12345"}';
    
    const result = signBybit({
      apiKey,
      apiSecret,
      method: 'PUT',
      queryString: '',
      body,
      timestamp,
      recvWindow
    });

    const expectedPayload = timestamp + apiKey + recvWindow + body;
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.headers['X-BAPI-SIGN']).toBe(expectedSig);
  });

  it('should sign DELETE request with query string', () => {
    const result = signBybit({
      apiKey,
      apiSecret,
      method: 'DELETE',
      queryString: 'orderId=12345',
      timestamp,
      recvWindow
    });

    const expectedPayload = timestamp + apiKey + recvWindow + 'orderId=12345';
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.headers['X-BAPI-SIGN']).toBe(expectedSig);
  });

  it('should handle POST with empty body', () => {
    const result = signBybit({
      apiKey,
      apiSecret,
      method: 'POST',
      queryString: 'some=param',
      body: '',
      timestamp,
      recvWindow
    });

    // Empty body should still be used for POST
    const expectedPayload = timestamp + apiKey + recvWindow + '';
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.headers['X-BAPI-SIGN']).toBe(expectedSig);
  });

  it('should handle case-insensitive method', () => {
    const body = '{"test":true}';
    
    const resultLower = signBybit({
      apiKey,
      apiSecret,
      method: 'post',
      queryString: '',
      body,
      timestamp,
      recvWindow
    });

    const resultUpper = signBybit({
      apiKey,
      apiSecret,
      method: 'POST',
      queryString: '',
      body,
      timestamp,
      recvWindow
    });

    expect(resultLower.headers['X-BAPI-SIGN']).toBe(resultUpper.headers['X-BAPI-SIGN']);
  });
});

describe('signOKX', () => {
  const apiKey = 'okx-api-key';
  const apiSecret = 'okx-api-secret';
  const passphrase = 'my-passphrase';
  const timestamp = '2024-01-15T10:30:00.000Z';

  it('should sign GET request', () => {
    const result = signOKX({
      apiKey,
      apiSecret,
      passphrase,
      method: 'GET',
      requestPath: '/api/v5/account/balance',
      timestamp
    });

    expect(result.headers['OK-ACCESS-KEY']).toBe(apiKey);
    expect(result.headers['OK-ACCESS-TIMESTAMP']).toBe(timestamp);
    expect(result.headers['OK-ACCESS-PASSPHRASE']).toBe(passphrase);

    // Verify signature (base64 encoded)
    const expectedPayload = timestamp + 'GET' + '/api/v5/account/balance' + '';
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('base64');
    expect(result.headers['OK-ACCESS-SIGN']).toBe(expectedSig);
  });

  it('should sign POST request with body', () => {
    const body = '{"instId":"BTC-USDT","tdMode":"cash"}';
    
    const result = signOKX({
      apiKey,
      apiSecret,
      passphrase,
      method: 'POST',
      requestPath: '/api/v5/trade/order',
      body,
      timestamp
    });

    // OKX always includes body in signature
    const expectedPayload = timestamp + 'POST' + '/api/v5/trade/order' + body;
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('base64');
    expect(result.headers['OK-ACCESS-SIGN']).toBe(expectedSig);
  });

  it('should include query params in requestPath', () => {
    const result = signOKX({
      apiKey,
      apiSecret,
      passphrase,
      method: 'GET',
      requestPath: '/api/v5/market/ticker?instId=BTC-USDT',
      timestamp
    });

    const expectedPayload = timestamp + 'GET' + '/api/v5/market/ticker?instId=BTC-USDT' + '';
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('base64');
    expect(result.headers['OK-ACCESS-SIGN']).toBe(expectedSig);
  });
});

describe('signMEXC', () => {
  const apiKey = 'mexc-api-key';
  const apiSecret = 'mexc-api-secret';
  const timestamp = '1700000000000';

  it('should sign request and return URL params', () => {
    const result = signMEXC({
      apiKey,
      apiSecret,
      queryString: 'symbol=BTCUSDT',
      timestamp
    });

    expect(result.headers['X-MEXC-APIKEY']).toBe(apiKey);
    expect(result.urlParams).toBeDefined();
    expect(result.urlParams?.timestamp).toBe(timestamp);
    expect(result.urlParams?.signature).toBeDefined();

    // Verify signature
    const expectedPayload = 'symbol=BTCUSDT&timestamp=' + timestamp;
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.urlParams?.signature).toBe(expectedSig);
  });

  it('should handle empty query string', () => {
    const result = signMEXC({
      apiKey,
      apiSecret,
      queryString: '',
      timestamp
    });

    const expectedPayload = 'timestamp=' + timestamp;
    const expectedSig = createHmac('sha256', apiSecret).update(expectedPayload).digest('hex');
    expect(result.urlParams?.signature).toBe(expectedSig);
  });
});

describe('signTwitterOAuth1a', () => {
  // Known-good test vector: deterministic nonce + timestamp so we can verify exact output
  const consumerKey = 'xvz1evFS4wEEPTGEFPHBog';
  const consumerSecret = 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw';
  const accessToken = '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb';
  const accessTokenSecret = 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE';
  const nonce = 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg';
  const timestamp = '1318622958';

  it('should produce correct Authorization header', () => {
    const result = signTwitterOAuth1a({
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
      method: 'POST',
      baseUrl: 'https://api.twitter.com/1.1/statuses/update.json',
      nonce,
      timestamp,
    });

    expect(result.headers['Authorization']).toContain('OAuth ');
    expect(result.headers['Authorization']).toContain(`oauth_consumer_key="${consumerKey}"`);
    expect(result.headers['Authorization']).toContain(`oauth_token="${accessToken}"`);
    expect(result.headers['Authorization']).toContain(`oauth_nonce="${nonce}"`);
    expect(result.headers['Authorization']).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(result.headers['Authorization']).toContain(`oauth_timestamp="${timestamp}"`);
    expect(result.headers['Authorization']).toContain('oauth_version="1.0"');
    expect(result.headers['Authorization']).toContain('oauth_signature=');
  });

  it('should compute a deterministic signature with fixed nonce/timestamp', () => {
    const result1 = signTwitterOAuth1a({
      consumerKey: 'ck',
      consumerSecret: 'cs',
      accessToken: 'at',
      accessTokenSecret: 'ats',
      method: 'POST',
      baseUrl: 'https://api.x.com/2/tweets',
      nonce: 'testnonce',
      timestamp: '1700000000',
    });

    const result2 = signTwitterOAuth1a({
      consumerKey: 'ck',
      consumerSecret: 'cs',
      accessToken: 'at',
      accessTokenSecret: 'ats',
      method: 'POST',
      baseUrl: 'https://api.x.com/2/tweets',
      nonce: 'testnonce',
      timestamp: '1700000000',
    });

    expect(result1.headers['Authorization']).toBe(result2.headers['Authorization']);
  });

  it('should manually verify signature base string and HMAC-SHA1', () => {
    const result = signTwitterOAuth1a({
      consumerKey: 'mykey',
      consumerSecret: 'mysecret',
      accessToken: 'mytoken',
      accessTokenSecret: 'mytokensecret',
      method: 'POST',
      baseUrl: 'https://api.x.com/2/tweets',
      nonce: 'abc123',
      timestamp: '1700000000',
    });

    // Reconstruct the expected signature
    const params = [
      'oauth_consumer_key=mykey',
      'oauth_nonce=abc123',
      'oauth_signature_method=HMAC-SHA1',
      'oauth_timestamp=1700000000',
      'oauth_token=mytoken',
      'oauth_version=1.0',
    ].join('&');

    const baseString = 'POST&' +
      encodeURIComponent('https://api.x.com/2/tweets') + '&' +
      encodeURIComponent(params);

    const signingKey = encodeURIComponent('mysecret') + '&' + encodeURIComponent('mytokensecret');
    const expectedSig = createHmac('sha1', signingKey).update(baseString).digest('base64');

    expect(result.headers['Authorization']).toContain(
      `oauth_signature="${encodeURIComponent(expectedSig)}"`
    );
  });

  it('should generate random nonce when not provided', () => {
    const result1 = signTwitterOAuth1a({
      consumerKey: 'k', consumerSecret: 's',
      accessToken: 't', accessTokenSecret: 'ts',
      method: 'POST', baseUrl: 'https://api.x.com/2/tweets',
    });
    const result2 = signTwitterOAuth1a({
      consumerKey: 'k', consumerSecret: 's',
      accessToken: 't', accessTokenSecret: 'ts',
      method: 'POST', baseUrl: 'https://api.x.com/2/tweets',
    });
    // Different nonces should produce different signatures
    expect(result1.headers['Authorization']).not.toBe(result2.headers['Authorization']);
  });

  it('should handle case-insensitive method', () => {
    const params = {
      consumerKey: 'k', consumerSecret: 's',
      accessToken: 't', accessTokenSecret: 'ts',
      baseUrl: 'https://api.x.com/2/tweets',
      nonce: 'n', timestamp: '1',
    };
    const lower = signTwitterOAuth1a({ ...params, method: 'post' });
    const upper = signTwitterOAuth1a({ ...params, method: 'POST' });
    expect(lower.headers['Authorization']).toBe(upper.headers['Authorization']);
  });
});
