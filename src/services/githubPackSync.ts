import { unzip } from 'fflate';
import { invoke } from '@tauri-apps/api/core';
import { readFile, remove } from '@tauri-apps/plugin-fs';
import db, { type Book } from '../db';
import { getSettings, updateSettings } from '../db';

// AES-GCM Key (must match packager.rs)
const ENCRYPTION_KEY = new TextEncoder().encode("InvronLabSecureKey2024!!_32bytes");
const NONCE_SIZE = 12;

export interface GithubVersionManifest {
  version?: string;
  latest_version?: string;
  pack_url?: string;
  download_url?: string;
  pack_name?: string;
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
 * Format any raw base64 or Data URI string into a valid web-renderable Data URI
 */
export function resolveCoverUrl(coverStr?: string | null): string {
  if (!coverStr || coverStr.trim() === '') return '';
  const trimmed = coverStr.trim().replace(/[\r\n]+/g, '');

  if (trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (trimmed.startsWith('iVBORw')) {
    return `data:image/png;base64,${trimmed}`;
  }
  if (trimmed.startsWith('/9j/')) {
    return `data:image/jpeg;base64,${trimmed}`;
  }
  if (trimmed.startsWith('UklGR')) {
    return `data:image/webp;base64,${trimmed}`;
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 100)) && trimmed.length > 50) {
    return `data:image/png;base64,${trimmed}`;
  }

  return trimmed;
}

/**
 * Resolves cover image either from cover_image_base64 or from extracted zip archive files
 */
function formatCoverUrl(coverStr: string | null | undefined, files: Record<string, Uint8Array>, bookId?: string): string {
  if (coverStr && coverStr.trim() !== '') {
    const trimmed = coverStr.trim();
    
    // If it's a file inside the zip (e.g. "covers/book_1.png")
    if (files[trimmed]) {
      const fileData = files[trimmed];
      const safeBuffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer;
      const isPng = trimmed.endsWith('.png');
      const isJpg = trimmed.endsWith('.jpg') || trimmed.endsWith('.jpeg');
      const isWebp = trimmed.endsWith('.webp');
      const mime = isPng ? 'image/png' : isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/jpeg';
      
      let binary = '';
      const bytes = new Uint8Array(safeBuffer);
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:${mime};base64,${btoa(binary)}`;
    }

    return resolveCoverUrl(trimmed);
  }

  // Fallback: search zip files for an image matching bookId
  if (bookId) {
    for (const key of Object.keys(files)) {
      if (key.includes(bookId) && (key.endsWith('.png') || key.endsWith('.jpg') || key.endsWith('.jpeg') || key.endsWith('.webp'))) {
        return formatCoverUrl(key, files);
      }
    }
  }

  return '';
}

/**
 * Fetch a URL as text via Rust reqwest (CORS-free).
 */
async function rustFetch(url: string): Promise<string> {
  return invoke<string>('fetch_cloud_manifest', { url });
}

/**
 * Check GitHub for a new version manifest.
 */
export async function checkGithubForUpdate(versionUrl: string): Promise<GithubVersionManifest | null> {
  try {
    const jsonText = await rustFetch(versionUrl);
    console.log(`[CloudSync] Manifest fetched successfully.`);
    return JSON.parse(jsonText) as GithubVersionManifest;
  } catch (err: any) {
    console.error(`[CloudSync] Failed to fetch manifest:`, err);
    throw new Error(`Cloud manifest fetch failed: ${err?.toString() || String(err)}`);
  }
}

/**
 * Query GitHub Releases API to find the actual .invronpack asset download URL.
 */
async function findReleaseAssetUrl(repo: string, tag: string): Promise<string | null> {
  try {
    const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;
    const jsonText = await rustFetch(apiUrl);
    const release = JSON.parse(jsonText);
    const asset = release.assets?.find((a: any) => a.name?.endsWith('.invronpack'));
    if (asset?.browser_download_url) {
      console.log(`[CloudSync] Found release asset: ${asset.browser_download_url}`);
      return asset.browser_download_url;
    }
  } catch (err) {
    console.warn(`[CloudSync] Releases API lookup failed:`, err);
  }
  return null;
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
      coverUrl: formatCoverUrl(entry.cover_image_base64, files, entry.id),
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
 */
export interface CloudSyncResult {
  success: boolean;
  status: 'updated' | 'already_up_to_date' | 'error';
  version?: string;
  summary?: SyncSummary;
  message: string;
}

const OFFICIAL_MANIFEST_URL = "https://raw.githubusercontent.com/inronlbs/invro-libera-books/main/manifest.json";

export async function performAutoUpdate(versionUrl?: string): Promise<CloudSyncResult> {
  const targetUrl = versionUrl || OFFICIAL_MANIFEST_URL;
  
  try {
    const settings = await getSettings();
    const currentVersion = settings.lastImportedVersion;
    
    console.log(`[AutoUpdate] Checking ${targetUrl}... Current version: ${currentVersion || 'none'}`);
    const manifest = await checkGithubForUpdate(targetUrl);
    
    if (!manifest) {
      return {
        success: false,
        status: 'error',
        message: 'Could not fetch catalog feed from GitHub manifest. Check network connection.'
      };
    }

    const version = manifest.version || manifest.latest_version;
    let packUrl = manifest.pack_url || manifest.download_url;

    if (!version) {
      return {
        success: false,
        status: 'error',
        message: 'Invalid manifest format: missing version.'
      };
    }

    // Resolve the actual download URL
    if (!packUrl || packUrl.trim() === '') {
      // Query GitHub Releases API to find the real .invronpack asset URL
      const assetUrl = await findReleaseAssetUrl('inronlbs/invro-libera-books', 'v1.0.0-books');
      if (assetUrl) {
        packUrl = assetUrl;
      } else {
        // Last resort: construct URL from pack_name
        const packName = manifest.pack_name || 'initial_catalog.invronpack';
        packUrl = `https://github.com/inronlbs/invro-libera-books/releases/download/v1.0.0-books/${packName}`;
      }
    }

    if (version === currentVersion) {
      console.log("[AutoUpdate] Already up to date.");
      return {
        success: true,
        status: 'already_up_to_date',
        version: version,
        summary: { added: 0, updated: 0, skipped: 0 },
        message: `Library is already up to date (Version ${version}).`
      };
    }
    
    console.log(`[AutoUpdate] New version ${version} found. Downloading from ${packUrl}...`);
    const tempPath = await invoke<string>('download_cloud_pack', { url: packUrl });
    console.log(`[AutoUpdate] Downloaded to temp file: ${tempPath}. Reading...`);
    
    // Read the temp file as binary using Tauri fs plugin (avoids JSON serialization of 220M bytes)
    const fileBytes = await readFile(tempPath);
    const buffer = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) as ArrayBuffer;
    console.log(`[AutoUpdate] Read ${buffer.byteLength} bytes from temp file. Importing...`);
    
    // Clean up temp file
    try { await remove(tempPath); } catch { /* ignore cleanup errors */ }
    
    const summary = await importInvronPackData(buffer);
    
    // Store new version
    await updateSettings({ lastImportedVersion: version });
    console.log(`[AutoUpdate] Complete. Added: ${summary.added}, Updated: ${summary.updated}`);
    
    return {
      success: true,
      status: 'updated',
      version: version,
      summary,
      message: `Successfully synced version ${version}! Added ${summary.added} new book(s).`
    };
  } catch (err: any) {
    console.error(`[AutoUpdate] Error during update flow:`, err);
    return {
      success: false,
      status: 'error',
      message: `Sync Error: ${err.message || err.toString()}`
    };
  }
}
