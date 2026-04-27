import { unzip } from 'fflate';
import db, { type Book } from '../db';
import { getSettings, updateSettings } from '../db';

// AES-GCM Key (must match packager.rs)
const ENCRYPTION_KEY = new TextEncoder().encode("InvronLabSecureKey2024!!_32bytes");
const NONCE_SIZE = 12;

export interface GithubVersionManifest {
  version: string;
  pack_url: string;
}

export interface SyncSummary {
  added: number;
  updated: number;
  skipped: number;
}

export interface PackagerBookEntry {
  id: string;
  title: string;
  author: string | null;
  assigned_class: string | null;
  cover_image_base64: string | null;
  type: string;
  original_filename: string;
  encrypted_filename: string;
  file_size: number;
  hidden: boolean;
}

export interface PackagerCatalog {
  books: PackagerBookEntry[];
}

/**
 * Decrypts an AES-256-GCM buffer using the fixed key.
 * Expected format: [Nonce: 12 bytes][Ciphertext + AuthTag]
 */
async function decryptBuffer(encryptedBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  // First 12 bytes are the nonce (iv)
  const nonce = encryptedBuffer.slice(0, NONCE_SIZE);
  const ciphertext = encryptedBuffer.slice(NONCE_SIZE);

  const importParams: AesKeyAlgorithm = { name: "AES-GCM", length: 256 };
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ENCRYPTION_KEY,
    importParams,
    false,
    ["decrypt"]
  );

  const decryptParams: AesGcmParams = {
    name: "AES-GCM",
    iv: new Uint8Array(nonce)
  };

  try {
    const decrypted = await crypto.subtle.decrypt(
      decryptParams,
      cryptoKey,
      ciphertext
    );
    return decrypted;
  } catch (error) {
    console.error("AES-GCM Decryption failed. Key mismatch or corrupted data.");
    throw error;
  }
}

/**
 * Utility to unzip a buffer using fflate async
 */
function unzipBuffer(buffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, unzipped) => {
      if (err) reject(err);
      else resolve(unzipped);
    });
  });
}

/**
 * Check GitHub for a new version manifest.
 */
export async function checkGithubForUpdate(versionUrl: string): Promise<GithubVersionManifest | null> {
  try {
    const res = await fetch(versionUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json() as GithubVersionManifest;
  } catch (e) {
    console.error("Failed to fetch version manifest", e);
    return null;
  }
}

/**
 * Download, decrypt, and import an .invronpack array buffer
 */
export async function importInvronPackData(buffer: ArrayBuffer): Promise<SyncSummary> {
  const summary: SyncSummary = { added: 0, updated: 0, skipped: 0 };
  
  // 1. Unzip the pack
  const files = await unzipBuffer(buffer);
  
  // 2. Read catalog
  const catalogData = files['book_catalog.json'];
  if (!catalogData) throw new Error("book_catalog.json not found in archive");
  
  const catalogStr = new TextDecoder().decode(catalogData);
  const catalog = JSON.parse(catalogStr) as PackagerCatalog;
  
  // 3. Process books
  for (const entry of catalog.books) {
    // Look for the encrypted file
    const encPath = `secure_books/${entry.encrypted_filename}`;
    const encData = files[encPath];
    
    if (!encData) {
      console.warn(`File ${encPath} missing from archive for book ${entry.title}`);
      continue;
    }
    
    // Check existing
    const existingBook = await db.books.get(entry.id);
    
    if (existingBook && existingBook.fileSize === entry.file_size) {
      // Already imported and same size, skip
      summary.skipped++;
      continue;
    }
    
    // Decrypt the file
    // fflate returns Uint8Array, we need a pure ArrayBuffer slice to avoid SharedArrayBuffer issues
    const safeBuffer = encData.buffer.slice(encData.byteOffset, encData.byteOffset + encData.byteLength) as ArrayBuffer;
    const decryptedData = await decryptBuffer(safeBuffer);
    const mimeType = entry.type === 'pdf' ? 'application/pdf' : 'application/epub+zip';
    const blob = new Blob([decryptedData], { type: mimeType });
    
    // Map to DB Book
    const newBook: Book = {
      id: entry.id,
      title: entry.title,
      author: entry.author || 'Unknown Author',
      type: entry.type === 'pdf' ? 'pdf' : 'epub',
      language: 'en',
      isBundled: true, // Imported from pack = local host source
      fileName: entry.original_filename,
      coverUrl: entry.cover_image_base64 || '',
      fileUrl: '', // No cloud URL, it's a blob
      downloadStatus: 'complete',
      fileSize: entry.file_size,
      downloadedBytes: entry.file_size,
      blob: blob,
      categories: ['All'],
      grade: entry.assigned_class || 'all',
      createdAt: existingBook ? existingBook.createdAt : new Date(),
      updatedAt: new Date(),
    };
    
    if (existingBook) {
      // Preserve read stats
      newBook.lastReadAt = existingBook.lastReadAt;
      newBook.assignedToUsers = existingBook.assignedToUsers;
      await db.books.put(newBook);
      summary.updated++;
    } else {
      await db.books.add(newBook);
      summary.added++;
    }
  }
  
  return summary;
}

/**
 * Full update flow: checks version, downloads pack, imports, and records new version.
 * Returns null if no update was needed or if it failed.
 */
export async function performAutoUpdate(versionUrl: string | undefined): Promise<SyncSummary | null> {
  if (!versionUrl) return null;
  
  const settings = await getSettings();
  const currentVersion = (settings as any).lastImportedVersion;
  
  console.log(`[AutoUpdate] Checking ${versionUrl}... Current version: ${currentVersion || 'none'}`);
  const manifest = await checkGithubForUpdate(versionUrl);
  
  if (!manifest || !manifest.pack_url || !manifest.version) {
    console.log("[AutoUpdate] Invalid manifest or fetch failed.");
    return null;
  }
  
  if (manifest.version === currentVersion) {
    console.log("[AutoUpdate] Already up to date.");
    return null;
  }
  
  console.log(`[AutoUpdate] New version ${manifest.version} found. Downloading...`);
  
  try {
    const packRes = await fetch(manifest.pack_url);
    if (!packRes.ok) throw new Error("Failed to download pack");
    
    const buffer = await packRes.arrayBuffer();
    console.log(`[AutoUpdate] Downloaded ${buffer.byteLength} bytes. importing...`);
    
    const summary = await importInvronPackData(buffer);
    
    // Store new version
    await updateSettings({ lastImportedVersion: manifest.version } as any);
    console.log(`[AutoUpdate] Complete. Added: ${summary.added}, Updated: ${summary.updated}`);
    
    return summary;
  } catch (err) {
    console.error(`[AutoUpdate] Error during update flow:`, err);
    return null;
  }
}
