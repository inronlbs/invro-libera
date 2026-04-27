/**
 * Invron E-Library - Resumable Download Manager
 * 
 * Features:
 * - Chunked downloads with HTTP Range headers
 * - Resumable downloads (persists chunks to IndexedDB)
 * - Progress tracking
 * - Firebase Storage compatible
 */

import db, { type Book } from '../db';
import { resolveValidatedDownloadUrl } from '../config/runtimeConfig';

// ============================================================================
// CONFIGURATION
// ============================================================================

const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// ============================================================================
// TYPES
// ============================================================================

export interface DownloadProgress {
  bookId: string;
  totalBytes: number;
  downloadedBytes: number;
  percentage: number;
  status: 'pending' | 'downloading' | 'complete' | 'failed' | 'paused';
  error?: string;
}

export interface DownloadCallbacks {
  onProgress?: (progress: DownloadProgress) => void;
  onComplete?: (book: Book) => void;
  onError?: (error: string) => void;
}

// ============================================================================
// DOWNLOAD MANAGER CLASS
// ============================================================================

export class DownloadManager {
  private activeDownloads: Map<string, AbortController> = new Map();
  private callbacks: Map<string, DownloadCallbacks> = new Map();

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Start or resume downloading a book
   */
  async startDownload(
    bookId: string,
    downloadUrl: string,
    callbacks: DownloadCallbacks = {}
  ): Promise<void> {
    // Check if already downloading
    if (this.activeDownloads.has(bookId)) {
      console.warn(`[DownloadManager] Book ${bookId} is already downloading`);
      return;
    }

    this.callbacks.set(bookId, callbacks);

    try {
      const validatedUrl = resolveValidatedDownloadUrl(downloadUrl).toString();

      // Try to get file size — first from local DB (already synced from Firestore),
      // then via HEAD request as fallback
      const book = await db.books.get(bookId);
      let fileSize = book?.fileSize || null;

      if (!fileSize) {
        fileSize = await this.getFileSize(validatedUrl);
      }

      // Update book status to downloading
      await db.books.update(bookId, {
        ...(fileSize ? { fileSize } : {}),
        downloadStatus: 'downloading'
      });

      // Create abort controller
      const abortController = new AbortController();
      this.activeDownloads.set(bookId, abortController);

      // If file size is unknown or small (< 2 MB), use simple single-request download
      // Also use simple download if Range requests fail
      if (!fileSize || fileSize < 2 * 1024 * 1024) {
        await this.simpleDownload(bookId, validatedUrl, fileSize || 0, abortController);
        return;
      }

      // Chunked download for larger files
      try {
        await this.chunkedDownload(bookId, validatedUrl, fileSize, abortController);
      } catch (rangeError) {
        // If Range requests failed (e.g. CORS / server doesn't support it),
        // fall back to simple download
        console.warn('[DownloadManager] Chunked download failed, falling back to simple:', rangeError);
        await db.downloadChunks.where('bookId').equals(bookId).delete();
        await this.simpleDownload(bookId, validatedUrl, fileSize, abortController);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      console.error(`[DownloadManager] Error:`, error);

      await this.updateStatus(bookId, 'failed');
      callbacks.onError?.(message);
    } finally {
      this.activeDownloads.delete(bookId);
    }
  }

  /**
   * Simple single-request download (no Range headers).
   * Works reliably with Firebase Storage and any server.
   */
  private async simpleDownload(
    bookId: string,
    url: string,
    expectedSize: number,
    abortController: AbortController
  ): Promise<void> {
    const callbacks = this.callbacks.get(bookId);
    try {
      this.reportProgress(bookId, expectedSize, 0, 'downloading');

      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : expectedSize;

      // Update fileSize if we now know the real size
      if (totalBytes && totalBytes !== expectedSize) {
        await db.books.update(bookId, { fileSize: totalBytes });
      }

      // Stream the response body to track progress
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let downloadedBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (abortController.signal.aborted) {
            reader.cancel();
            await this.updateStatus(bookId, 'paused', downloadedBytes);
            return;
          }
          chunks.push(value);
          downloadedBytes += value.byteLength;
          this.reportProgress(bookId, totalBytes || downloadedBytes, downloadedBytes, 'downloading');
        }

        // Assemble into final blob directly from chunks (avoids allocating
        // a single contiguous Uint8Array which can crash on large files)
        const actualSize = downloadedBytes;
        const book = await db.books.get(bookId);
        const mimeType = book?.type === 'pdf' ? 'application/pdf' : 'application/epub+zip';
        const blob = new Blob(chunks as BlobPart[], { type: mimeType });

        await db.books.update(bookId, {
          blob,
          downloadStatus: 'complete',
          downloadedBytes: actualSize,
          fileSize: actualSize,
          updatedAt: new Date()
        });

        this.reportProgress(bookId, actualSize, actualSize, 'complete');
        const updatedBook = await db.books.get(bookId);
        if (updatedBook) callbacks?.onComplete?.(updatedBook);
        console.log(`[DownloadManager] Book ${bookId} download complete (simple mode, ${actualSize} bytes)`);
      } else {
        // Fallback: no streaming body support
        const arrayBuffer = await response.arrayBuffer();
        if (abortController.signal.aborted) return;

        const book = await db.books.get(bookId);
        const mimeType = book?.type === 'pdf' ? 'application/pdf' : 'application/epub+zip';
        const blob = new Blob([arrayBuffer], { type: mimeType });

        await db.books.update(bookId, {
          blob,
          downloadStatus: 'complete',
          downloadedBytes: arrayBuffer.byteLength,
          fileSize: arrayBuffer.byteLength,
          updatedAt: new Date()
        });

        this.reportProgress(bookId, arrayBuffer.byteLength, arrayBuffer.byteLength, 'complete');
        const updatedBook = await db.books.get(bookId);
        if (updatedBook) callbacks?.onComplete?.(updatedBook);
        console.log(`[DownloadManager] Book ${bookId} download complete (simple/buffer, ${arrayBuffer.byteLength} bytes)`);
      }
    } catch (error) {
      if (abortController.signal.aborted) return;
      throw error; // Let the outer catch handle it
    }
  }

  /**
   * Chunked download with Range headers for large files.
   */
  private async chunkedDownload(
    bookId: string,
    downloadUrl: string,
    fileSize: number,
    abortController: AbortController
  ): Promise<void> {
    const existingChunks = await db.downloadChunks
      .where('bookId')
      .equals(bookId)
      .toArray();

    const downloadedChunkIndices = new Set(existingChunks.map(c => c.chunkIndex));
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    let downloadedBytes = existingChunks.reduce((sum, c) => sum + c.data.byteLength, 0);

    for (let i = 0; i < totalChunks; i++) {
      if (downloadedChunkIndices.has(i)) continue;

      if (abortController.signal.aborted) {
        await this.updateStatus(bookId, 'paused', downloadedBytes);
        return;
      }

      const startByte = i * CHUNK_SIZE;
      const endByte = Math.min(startByte + CHUNK_SIZE - 1, fileSize - 1);

      const chunkData = await this.downloadChunkWithRetry(
        downloadUrl, startByte, endByte, abortController.signal
      );

      if (!chunkData) throw new Error(`Failed to download chunk ${i}`);

      await db.downloadChunks.add({
        id: `${bookId}_${i}`,
        bookId,
        chunkIndex: i,
        startByte,
        endByte,
        data: chunkData,
        downloadedAt: new Date()
      });

      downloadedBytes += chunkData.byteLength;
      this.reportProgress(bookId, fileSize, downloadedBytes, 'downloading');
    }

    await this.assembleFile(bookId, fileSize);
  }

  /**
   * Pause a download
   */
  pauseDownload(bookId: string): void {
    const controller = this.activeDownloads.get(bookId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(bookId);
    }
  }

  /**
   * Cancel and remove a download (deletes chunks)
   */
  async cancelDownload(bookId: string): Promise<void> {
    this.pauseDownload(bookId);

    // Delete all chunks
    await db.downloadChunks.where('bookId').equals(bookId).delete();

    // Reset book status
    await db.books.update(bookId, {
      downloadStatus: 'pending',
      downloadedBytes: 0
    });
  }

  /**
   * Check if a book has partial download
   */
  async hasPartialDownload(bookId: string): Promise<boolean> {
    const chunks = await db.downloadChunks.where('bookId').equals(bookId).count();
    return chunks > 0;
  }

  /**
   * Get download progress for a book
   */
  async getProgress(bookId: string): Promise<DownloadProgress | null> {
    const book = await db.books.get(bookId);
    if (!book) return null;

    const chunks = await db.downloadChunks.where('bookId').equals(bookId).toArray();
    const downloadedBytes = chunks.reduce((sum, c) => sum + c.data.byteLength, 0);

    return {
      bookId,
      totalBytes: book.fileSize || 0,
      downloadedBytes,
      percentage: book.fileSize ? Math.round((downloadedBytes / book.fileSize) * 100) : 0,
      status: book.downloadStatus
    };
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Get file size using HEAD request
   */
  private async getFileSize(url: string): Promise<number | null> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const contentLength = response.headers.get('content-length');
      return contentLength ? parseInt(contentLength, 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * Download a chunk with retry logic
   */
  private async downloadChunkWithRetry(
    url: string,
    startByte: number,
    endByte: number,
    signal: AbortSignal,
    retries = 0
  ): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'Range': `bytes=${startByte}-${endByte}`
        },
        signal
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      if (signal.aborted) return null;

      if (retries < MAX_RETRIES) {
        console.warn(`[DownloadManager] Retry ${retries + 1}/${MAX_RETRIES}`);
        await this.delay(RETRY_DELAY);
        return this.downloadChunkWithRetry(url, startByte, endByte, signal, retries + 1);
      }

      throw error;
    }
  }

  /**
   * Assemble all chunks into a single Blob
   */
  private async assembleFile(bookId: string, totalSize: number): Promise<void> {
    const chunks = await db.downloadChunks
      .where('bookId')
      .equals(bookId)
      .sortBy('chunkIndex');

    // Create Blob directly from chunk data arrays — the browser handles
    // memory-efficient concatenation internally, avoiding a massive
    // contiguous Uint8Array allocation that could crash low-memory devices.
    const book = await db.books.get(bookId);
    const mimeType = book?.type === 'pdf'
      ? 'application/pdf'
      : 'application/epub+zip';

    const blob = new Blob(chunks.map(c => c.data), { type: mimeType });

    // Update book with blob and mark complete
    await db.books.update(bookId, {
      blob,
      downloadStatus: 'complete',
      downloadedBytes: totalSize,
      updatedAt: new Date()
    });

    // Delete chunks (no longer needed)
    await db.downloadChunks.where('bookId').equals(bookId).delete();

    // Report completion
    this.reportProgress(bookId, totalSize, totalSize, 'complete');

    const updatedBook = await db.books.get(bookId);
    if (updatedBook) {
      this.callbacks.get(bookId)?.onComplete?.(updatedBook);
    }

    console.log(`[DownloadManager] Book ${bookId} download complete`);
  }

  /**
   * Update book download status
   */
  private async updateStatus(
    bookId: string,
    status: Book['downloadStatus'],
    downloadedBytes?: number
  ): Promise<void> {
    await db.books.update(bookId, {
      downloadStatus: status,
      ...(downloadedBytes !== undefined && { downloadedBytes })
    });
  }

  /**
   * Report progress to callbacks
   */
  private reportProgress(
    bookId: string,
    totalBytes: number,
    downloadedBytes: number,
    status: DownloadProgress['status']
  ): void {
    const progress: DownloadProgress = {
      bookId,
      totalBytes,
      downloadedBytes,
      percentage: Math.round((downloadedBytes / totalBytes) * 100),
      status
    };

    // Update book record
    db.books.update(bookId, { downloadedBytes });

    // Notify callback
    this.callbacks.get(bookId)?.onProgress?.(progress);
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const downloadManager = new DownloadManager();

export default downloadManager;
