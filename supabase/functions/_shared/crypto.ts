import { sha256 } from '@noble/hashes/sha256';
import { envGet } from './env.ts';

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function isPasswordHashed(stored: unknown): boolean {
  return String(stored || '').indexOf('sha256:') === 0;
}

/** Sync SHA-256 password hash matching Code.js format: sha256:{salt}:{base64digest} */
export function hashPassword(password: string): string {
  const salt = crypto.randomUUID();
  const digest = sha256(utf8Bytes(salt + String(password)));
  return 'sha256:' + salt + ':' + bytesToBase64(digest);
}

export function verifyPassword(input: string, stored: unknown): boolean {
  if (!stored) return false;
  const s = String(stored);
  if (isPasswordHashed(s)) {
    const parts = s.split(':');
    if (parts.length < 3) return false;
    const digest = sha256(utf8Bytes(parts[1] + String(input)));
    return bytesToBase64(digest) === parts.slice(2).join(':');
  }
  return String(input).toLowerCase() === s.toLowerCase();
}

let _vaultSecret: string | null = null;

function getVaultSecret(): string {
  if (_vaultSecret) return _vaultSecret;
  _vaultSecret = envGet('VAULT_SECRET') || (crypto.randomUUID() + crypto.randomUUID());
  return _vaultSecret;
}

export function vaultEncrypt(plain: unknown): string {
  if (!plain) return '';
  const key = getVaultSecret();
  const bytes = utf8Bytes(String(plain));
  const keyBytes = utf8Bytes(key);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i] ^ keyBytes[i % keyBytes.length]);
  return 'enc:' + bytesToBase64(new Uint8Array(out));
}

export function vaultDecrypt(enc: unknown): string {
  if (!enc || String(enc).indexOf('enc:') !== 0) return '';
  const key = getVaultSecret();
  const bytes = base64ToBytes(String(enc).substring(4));
  const keyBytes = utf8Bytes(key);
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i] ^ keyBytes[i % keyBytes.length]);
  return new TextDecoder().decode(new Uint8Array(out));
}

export function shortId(): string {
  return crypto.randomUUID().split('-')[0].toUpperCase();
}
