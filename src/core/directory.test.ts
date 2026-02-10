/**
 * Tests for service directory
 */

import { describe, it, expect } from 'vitest';
import { searchDirectory, getService, listByCategory, serviceDirectory } from './directory';

describe('Service Directory', () => {
  describe('searchDirectory', () => {
    it('should find service by exact name', () => {
      const results = searchDirectory('stripe');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('stripe');
    });

    it('should find service by partial name', () => {
      const results = searchDirectory('git');
      expect(results.some(s => s.name === 'github')).toBe(true);
    });

    it('should find services by tag', () => {
      const results = searchDirectory('crypto');
      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results.every(s => s.tags.includes('crypto'))).toBe(true);
    });

    it('should find services by description', () => {
      const results = searchDirectory('payment');
      expect(results.some(s => s.name === 'stripe')).toBe(true);
    });

    it('should be case insensitive', () => {
      const lower = searchDirectory('stripe');
      const upper = searchDirectory('STRIPE');
      const mixed = searchDirectory('StRiPe');
      expect(lower).toEqual(upper);
      expect(lower).toEqual(mixed);
    });

    it('should return empty array for no matches', () => {
      const results = searchDirectory('xyznonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('getService', () => {
    it('should get service by exact name', () => {
      const service = getService('stripe');
      expect(service).toBeDefined();
      expect(service?.name).toBe('stripe');
      expect(service?.baseUrl).toBe('https://api.stripe.com');
    });

    it('should be case insensitive', () => {
      const lower = getService('stripe');
      const upper = getService('STRIPE');
      expect(lower).toEqual(upper);
    });

    it('should return undefined for unknown service', () => {
      const service = getService('nonexistent');
      expect(service).toBeUndefined();
    });
  });

  describe('listByCategory', () => {
    it('should group services by primary tag', () => {
      const categories = listByCategory();
      expect(categories.size).toBeGreaterThan(0);
      
      // Check that crypto services are grouped
      const crypto = categories.get('crypto');
      expect(crypto).toBeDefined();
      expect(crypto!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('serviceDirectory entries', () => {
    it('all services should have required fields', () => {
      for (const service of serviceDirectory) {
        expect(service.name).toBeTruthy();
        expect(service.description).toBeTruthy();
        expect(service.baseUrl).toBeTruthy();
        expect(service.auth.type).toBeTruthy();
        expect(service.auth.fields.length).toBeGreaterThan(0);
        expect(service.tags.length).toBeGreaterThan(0);
      }
    });

    it('all services should have valid auth types', () => {
      const validTypes = ['bearer', 'basic', 'hmac-mexc', 'hmac-bybit', 'hmac-okx', 'headers'];
      for (const service of serviceDirectory) {
        expect(validTypes).toContain(service.auth.type);
      }
    });

    it('should include common services', () => {
      const names = serviceDirectory.map(s => s.name);
      expect(names).toContain('stripe');
      expect(names).toContain('github');
      expect(names).toContain('openai');
      expect(names).toContain('bybit');
      expect(names).toContain('slack');
    });
  });
});
