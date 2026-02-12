/**
 * Tests for audit logger
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger, APIRequest, APIResponse } from './audit';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('AuditLogger', () => {
  let tempDir: string;
  let logger: AuditLogger;

  beforeEach(() => {
    // Create temp directory for test logs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janee-test-'));
    logger = new AuditLogger(tempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Request Body Logging', () => {
    it('should log POST request body when enabled (default)', () => {
      const request: APIRequest = {
        service: 'test-service',
        method: 'POST',
        path: '/v1/test',
        headers: {},
        body: JSON.stringify({ test: 'data' })
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      // Read log file
      const logFiles = fs.readdirSync(tempDir);
      expect(logFiles.length).toBe(1);

      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBe(JSON.stringify({ test: 'data' }));
      expect(logEntry.method).toBe('POST');
    });

    it('should log PUT request body', () => {
      const request: APIRequest = {
        service: 'test-service',
        method: 'PUT',
        path: '/v1/test/123',
        headers: {},
        body: JSON.stringify({ updated: true })
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBe(JSON.stringify({ updated: true }));
    });

    it('should log PATCH request body', () => {
      const request: APIRequest = {
        service: 'test-service',
        method: 'PATCH',
        path: '/v1/test/123',
        headers: {},
        body: JSON.stringify({ patched: true })
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBe(JSON.stringify({ patched: true }));
    });

    it('should not log GET request body', () => {
      const request: APIRequest = {
        service: 'test-service',
        method: 'GET',
        path: '/v1/test',
        headers: {},
        body: 'should-not-be-logged'
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBeUndefined();
    });

    it('should not log DELETE request body', () => {
      const request: APIRequest = {
        service: 'test-service',
        method: 'DELETE',
        path: '/v1/test/123',
        headers: {},
        body: 'should-not-be-logged'
      };

      const response: APIResponse = {
        statusCode: 204,
        headers: {},
        body: ''
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBeUndefined();
    });

    it('should not log body when logBodies is false', () => {
      const loggerNoBody = new AuditLogger(tempDir, { logBodies: false });

      const request: APIRequest = {
        service: 'test-service',
        method: 'POST',
        path: '/v1/test',
        headers: {},
        body: JSON.stringify({ test: 'data' })
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      loggerNoBody.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBeUndefined();
    });

    it('should truncate large request bodies at 10KB', () => {
      // Create a body larger than 10KB
      const largeBody = 'x'.repeat(15 * 1024); // 15KB

      const request: APIRequest = {
        service: 'test-service',
        method: 'POST',
        path: '/v1/test',
        headers: {},
        body: largeBody
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBeDefined();
      expect(logEntry.requestBody?.length).toBeLessThan(largeBody.length);
      expect(logEntry.requestBody).toContain('... [truncated, original length: 15360]');
      expect(logEntry.requestBody?.substring(0, 10240)).toBe(largeBody.substring(0, 10240));
    });

    it('should not truncate bodies under 10KB', () => {
      const smallBody = 'x'.repeat(5 * 1024); // 5KB

      const request: APIRequest = {
        service: 'test-service',
        method: 'POST',
        path: '/v1/test',
        headers: {},
        body: smallBody
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBe(smallBody);
      expect(logEntry.requestBody).not.toContain('[truncated');
    });

    it('should handle missing request body', () => {
      const request: APIRequest = {
        service: 'test-service',
        method: 'POST',
        path: '/v1/test',
        headers: {}
        // No body
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.requestBody).toBeUndefined();
    });
  });

  describe('Basic Logging', () => {
    it('should log basic request metadata', () => {
      const request: APIRequest = {
        service: 'stripe',
        method: 'GET',
        path: '/v1/balance',
        headers: {}
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response, 123);

      const logFiles = fs.readdirSync(tempDir);
      expect(logFiles.length).toBe(1);

      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.service).toBe('stripe');
      expect(logEntry.method).toBe('GET');
      expect(logEntry.path).toBe('/v1/balance');
      expect(logEntry.statusCode).toBe(200);
      expect(logEntry.duration).toBe(123);
      expect(logEntry.id).toBeDefined();
      expect(logEntry.timestamp).toBeDefined();
    });
  });

  describe('Header Extraction', () => {
    it('should extract reason from X-Janee-Reason header', () => {
      const request: APIRequest = {
        service: 'stripe',
        method: 'POST',
        path: '/v1/charges',
        headers: {
          'X-Janee-Reason': 'Processing payment for order #12345'
        }
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.reason).toBe('Processing payment for order #12345');
    });

    it('should extract agentId from X-Janee-Agent-Id header', () => {
      const request: APIRequest = {
        service: 'github',
        method: 'GET',
        path: '/user',
        headers: {
          'X-Janee-Agent-Id': 'claude-desktop-v1.2.3'
        }
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.agentId).toBe('claude-desktop-v1.2.3');
    });

    it('should extract both reason and agentId from headers', () => {
      const request: APIRequest = {
        service: 'openai',
        method: 'POST',
        path: '/v1/chat/completions',
        headers: {
          'X-Janee-Reason': 'Generate summary for user report',
          'X-Janee-Agent-Id': 'cursor-ide-v0.40.0'
        }
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.reason).toBe('Generate summary for user report');
      expect(logEntry.agentId).toBe('cursor-ide-v0.40.0');
    });

    it('should handle lowercase header names', () => {
      const request: APIRequest = {
        service: 'test',
        method: 'GET',
        path: '/test',
        headers: {
          'x-janee-reason': 'Test with lowercase headers',
          'x-janee-agent-id': 'test-agent'
        }
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.reason).toBe('Test with lowercase headers');
      expect(logEntry.agentId).toBe('test-agent');
    });

    it('should not include reason/agentId fields when headers are missing', () => {
      const request: APIRequest = {
        service: 'test',
        method: 'GET',
        path: '/test',
        headers: {}
      };

      const response: APIResponse = {
        statusCode: 200,
        headers: {},
        body: '{}'
      };

      logger.log(request, response);

      const logFiles = fs.readdirSync(tempDir);
      const logContent = fs.readFileSync(path.join(tempDir, logFiles[0]), 'utf8');
      const logEntry = JSON.parse(logContent.trim());

      expect(logEntry.reason).toBeUndefined();
      expect(logEntry.agentId).toBeUndefined();
    });
  });
});
