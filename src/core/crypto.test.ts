import { describe, it, expect } from 'vitest';
import {
  generateMasterKey,
  encryptSecret,
  decryptSecret,
  hashString,
  generateToken
} from './crypto';

describe('Crypto', () => {
  describe('generateMasterKey', () => {
    it('should generate a base64-encoded 32-byte key', () => {
      const key = generateMasterKey();
      const decoded = Buffer.from(key, 'base64');
      expect(decoded.length).toBe(32);
    });

    it('should generate unique keys each time', () => {
      const key1 = generateMasterKey();
      const key2 = generateMasterKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    it('should encrypt and decrypt a simple string', () => {
      const key = generateMasterKey();
      const plaintext = 'my-secret-api-key';
      const encrypted = encryptSecret(plaintext, key);
      const decrypted = decryptSecret(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt an empty string', () => {
      const key = generateMasterKey();
      const encrypted = encryptSecret('', key);
      const decrypted = decryptSecret(encrypted, key);
      expect(decrypted).toBe('');
    });

    it('should encrypt and decrypt unicode text', () => {
      const key = generateMasterKey();
      const plaintext = '🔐 secret with émojis and ñ characters 日本語';
      const encrypted = encryptSecret(plaintext, key);
      const decrypted = decryptSecret(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should encrypt and decrypt long text', () => {
      const key = generateMasterKey();
      const plaintext = 'a'.repeat(10000);
      const encrypted = encryptSecret(plaintext, key);
      const decrypted = decryptSecret(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertexts for the same plaintext (random IV)', () => {
      const key = generateMasterKey();
      const plaintext = 'same-secret';
      const encrypted1 = encryptSecret(plaintext, key);
      const encrypted2 = encryptSecret(plaintext, key);
      expect(encrypted1).not.toBe(encrypted2);
      // But both should decrypt to same value
      expect(decryptSecret(encrypted1, key)).toBe(plaintext);
      expect(decryptSecret(encrypted2, key)).toBe(plaintext);
    });

    it('should fail to decrypt with wrong key', () => {
      const key1 = generateMasterKey();
      const key2 = generateMasterKey();
      const encrypted = encryptSecret('secret', key1);
      expect(() => decryptSecret(encrypted, key2)).toThrow();
    });

    it('should fail with tampered ciphertext', () => {
      const key = generateMasterKey();
      const encrypted = encryptSecret('secret', key);
      // Flip a character in the middle of the ciphertext
      const buf = Buffer.from(encrypted, 'base64');
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => decryptSecret(tampered, key)).toThrow();
    });

    it('should reject invalid master key length', () => {
      const shortKey = Buffer.from('too-short').toString('base64');
      expect(() => encryptSecret('secret', shortKey)).toThrow('Invalid master key length');
      expect(() => decryptSecret('dummy', shortKey)).toThrow('Invalid master key length');
    });

    it('should handle newlines and special characters in plaintext', () => {
      const key = generateMasterKey();
      const plaintext = 'line1\nline2\ttab\0null\r\nwindows';
      const encrypted = encryptSecret(plaintext, key);
      const decrypted = decryptSecret(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('hashString', () => {
    it('should produce a 64-character hex SHA-256 hash', () => {
      const hash = hashString('hello');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should be deterministic', () => {
      expect(hashString('test')).toBe(hashString('test'));
    });

    it('should produce different hashes for different inputs', () => {
      expect(hashString('a')).not.toBe(hashString('b'));
    });

    it('should match known SHA-256 value', () => {
      // SHA-256 of empty string
      expect(hashString('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
    });
  });

  describe('generateToken', () => {
    it('should generate a hex token of specified length', () => {
      const token = generateToken('', 16);
      // 16 bytes = 32 hex chars
      expect(token).toHaveLength(32);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('should prepend prefix with underscore', () => {
      const token = generateToken('jnee_sess', 32);
      expect(token).toMatch(/^jnee_sess_[0-9a-f]{64}$/);
    });

    it('should generate unique tokens', () => {
      const t1 = generateToken('test', 32);
      const t2 = generateToken('test', 32);
      expect(t1).not.toBe(t2);
    });

    it('should work with no prefix', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should default to 32 bytes (64 hex chars)', () => {
      const token = generateToken();
      expect(token).toHaveLength(64);
    });
  });
});
