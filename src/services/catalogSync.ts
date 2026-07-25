import { db, type Book } from '../db';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnvironment } from './localAuth';

export interface CatalogSyncResult {
  syncedCount: number;
  fetchedCount: number;
}

interface RemoteBookEntry {
  id: string;
  title: string;
  author?: string;
  type?: string;
  original_filename?: string;
  cover_image_base64?: string;
  category?: string;
  assigned_class?: string;
  file_size?: number;
}

export async function syncCatalogForUser(): Promise<CatalogSyncResult> {
  try {
    let catalog: RemoteBookEntry[];

    if (isTauriEnvironment()) {
      catalog = await invoke<RemoteBookEntry[]>('get_book_catalog');
    } else {
      const host = window.location.hostname === 'tauri.localhost' || window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
      // Fetch the catalog from the Axum HTTP server running on the Host PC
      const port = window.location.port || '3000';
      const response = await fetch(`http://${host}:${port}/api/catalog`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      // The backend returns a list of BookEntry objects from rust
      catalog = await response.json();
    }
    
    const remoteBooks: Book[] = catalog.map(entry => ({
      id: entry.id,
      title: entry.title,
      author: entry.author || 'Unknown Author',
      type: entry.type === 'pdf' ? 'pdf' : 'epub',
      language: 'en',
      isBundled: false,
      fileName: entry.original_filename || '',
      coverUrl: entry.cover_image_base64 || '',
      fileUrl: '',
      downloadStatus: 'pending',
      categories: entry.category ? [entry.category] : ['All'],
      grade: entry.assigned_class || 'all',
      fileSize: entry.file_size,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    // Merge with local db to preserve read status and local blob cache if any
    const existingBooks = await db.books.toArray();
    const existingMap = new Map(existingBooks.map((book) => [book.id, book]));

    const mergedBooks = remoteBooks.map((remoteBook) => {
      const localBook = existingMap.get(remoteBook.id);
      if (!localBook) return remoteBook;

      return {
        ...remoteBook,
        downloadStatus: localBook.downloadStatus,
        downloadedBytes: localBook.downloadedBytes,
        blob: localBook.blob,
        lastReadAt: localBook.lastReadAt,
        assignedToUsers: localBook.assignedToUsers
      };
    });

    await db.books.bulkPut(mergedBooks);

    // Delete books that no longer exist on the remote host (to prevent duplicates if the host regenerates its catalog)
    const remoteIds = new Set(remoteBooks.map(b => b.id));
    const toDeleteIds = existingBooks
      .filter(b => !b.isBundled && !remoteIds.has(b.id))
      .map(b => b.id);
      
    if (toDeleteIds.length > 0) {
      await db.books.bulkDelete(toDeleteIds);
      console.log(`[Sync] Deleted ${toDeleteIds.length} orphaned books.`);
    }

    return {
      syncedCount: mergedBooks.length,
      fetchedCount: remoteBooks.length,
    };
  } catch (error) {
    console.error('Failed to sync catalog from Host:', error);
    throw error;
  }
}

export function formatCatalogSyncError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'The library could not be synced right now.';
}

/**
 * Silent wrapper for auto-syncing on app launch.
 * Enforces a 3-second timeout so it doesn't hang if the host is offline.
 */
import { performAutoUpdate } from './githubPackSync';

export async function syncOnLaunch(): Promise<void> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    // Also trigger cloud pack check
    void performAutoUpdate();

    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Sync timeout')), 3000);
    });
    
    await Promise.race([
      syncCatalogForUser(),
      timeoutPromise
    ]);
    console.log('[AutoSync] Incremental catalog sync completed');
  } catch {
    // Silently ignore: it just means host is offline or not reachable
    console.log('[AutoSync] Skipped - Host unreachable or timeout');
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}