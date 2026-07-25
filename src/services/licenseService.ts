/**
 * License Service — Decrypt and validate .invronkey activation files
 * Uses the same AES-256-GCM encryption as the Dev Studio packager.
 */

import { getSettings, updateSettings } from '../db';
import { invoke } from '@tauri-apps/api/core';

// Must match the key in Dev Studio's licensing.rs and packager.rs
const ENCRYPTION_KEY = new TextEncoder().encode("InvronLabSecureKey2024!!_32bytes");
const NONCE_SIZE = 12;

export interface LicenseData {
  format: string;
  key: string;
  school_name: string;
  lab_name: string;
  device_id: string;
  issued_at: string;
  expires_at: string;
}

/**
 * Decrypt an AES-256-GCM encrypted buffer. Format: [nonce:12][ciphertext+tag]
 */
async function decryptBuffer(encrypted: ArrayBuffer): Promise<string> {
  const nonce = encrypted.slice(0, NONCE_SIZE);
  const ciphertext = encrypted.slice(NONCE_SIZE);

  const cryptoKey = await crypto.subtle.importKey(
    "raw", ENCRYPTION_KEY, { name: "AES-GCM", length: 256 } as AesKeyAlgorithm, false, ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) } as AesGcmParams,
    cryptoKey,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Import and validate a .invronkey file buffer
 */
export async function importKeyFile(buffer: ArrayBuffer): Promise<LicenseData> {
  let json: string;
  try {
    json = await decryptBuffer(buffer);
  } catch {
    throw new Error("Invalid or corrupted key file. Decryption failed.");
  }

  let data: LicenseData;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Key file contains invalid data.");
  }

  if (data.format !== 'invron-key-v1') {
    throw new Error(`Unsupported key format: ${data.format}`);
  }
  if (!data.key || !data.expires_at) {
    throw new Error("Key file is missing required fields.");
  }

  return data;
}

/**
 * Save license data to local settings
 */
export async function activateLicense(data: LicenseData): Promise<void> {
  await updateSettings({
    licenseKey: data.key,
    licenseSchool: data.school_name,
    licenseLab: data.lab_name,
    licenseDeviceId: data.device_id,
    licenseIssuedAt: data.issued_at,
    licenseExpiresAt: data.expires_at,
  });

  try {
    await invoke('log_frontend_event', {
      action: 'LICENSE_ACTIVATED',
      details: `Activated device with key: ${data.key} for ${data.school_name || 'Unknown School'}`,
    });
  } catch (e) {
    console.warn("Failed to log license activation:", e);
  }
}

/**
 * Check if a valid, non-expired license exists
 */
export async function checkLicense(): Promise<{ valid: boolean; data?: LicenseData; reason?: string }> {
  const settings = await getSettings();

  if (!settings.licenseKey) {
    return { valid: false, reason: 'no_license' };
  }

  const expiresAt = new Date(settings.licenseExpiresAt || '');
  if (isNaN(expiresAt.getTime())) {
    return { valid: false, reason: 'invalid_expiry' };
  }

  if (expiresAt < new Date()) {
    return {
      valid: false,
      reason: 'expired',
      data: {
        format: 'invron-key-v1',
        key: settings.licenseKey,
        school_name: settings.licenseSchool || '',
        lab_name: settings.licenseLab || '',
        device_id: settings.licenseDeviceId || '',
        issued_at: settings.licenseIssuedAt || '',
        expires_at: settings.licenseExpiresAt || '',
      }
    };
  }

  return {
    valid: true,
    data: {
      format: 'invron-key-v1',
      key: settings.licenseKey,
      school_name: settings.licenseSchool || '',
      lab_name: settings.licenseLab || '',
      device_id: settings.licenseDeviceId || '',
      issued_at: settings.licenseIssuedAt || '',
      expires_at: settings.licenseExpiresAt || '',
    }
  };
}

/**
 * Days remaining on the license
 */
export function daysRemaining(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
}

/**
 * Retrieve stable Windows Registry MachineGuid hardware fingerprint
 */
export async function getDeviceFingerprint(): Promise<string> {
  try {
    return await invoke<string>('get_device_fingerprint');
  } catch (err) {
    console.warn('[License] Failed to fetch device fingerprint:', err);
    return 'STANDALONE-DEV-GUID';
  }
}

/**
 * Native license status check from Rust backend
 */
export async function getNativeLicenseStatus() {
  try {
    return await invoke<{
      is_valid: boolean;
      school_name?: string;
      machine_guid: string;
      expiry_date?: string;
      days_remaining?: number;
      message: string;
    }>('get_license_status');
  } catch (err) {
    console.warn('[License] Failed to fetch native license status:', err);
    return {
      is_valid: false,
      machine_guid: 'STANDALONE-DEV-GUID',
      message: 'License verification service unavailable'
    };
  }
}

