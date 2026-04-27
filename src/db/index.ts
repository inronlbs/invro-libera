/**
 * Invron E-Library - IndexedDB Schema using Dexie.js
 * 
 * This module defines the local database for:
 * - Storing book metadata and files (Blobs)
 * - Tracking reading progress
 * - Managing download state for resumable downloads
 */

import Dexie, { type EntityTable } from 'dexie';
import { getClientSession } from '../services/localAuth';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type BookType = 'pdf' | 'epub';
export type DownloadStatus = 'pending' | 'downloading' | 'complete' | 'failed' | 'paused';
export type LanguageCode = 'en' | 'fr' | 'es' | 'hi' | 'ar' | 'zh' | 'ml';

export interface Book {
  id: string;                    // UUID from backend
  title: string;
  author: string;
  type: BookType;
  language: LanguageCode;        // Used to determine TTS eligibility (only 'en')

  // Storage Source
  isBundled: boolean;            // true = shipped with app, false = download from Firebase
  fileName: string;              // e.g., "science-g4.pdf"
  coverUrl: string;              // Path to cover image (local or Firebase URL)
  fileUrl?: string;              // Direct URL to the file in Cloud Storage

  // Download State (for cloud books)
  downloadStatus: DownloadStatus;
  fileSize?: number;             // Total size in bytes
  downloadedBytes?: number;      // For resumable downloads

  // The actual file (stored after download completes)
  blob?: Blob;

  // Metadata
  totalPages?: number;
  categories?: string[];
  grade?: string;
  assignedToUsers?: string[];    // Firebase UIDs of users who have access to this book
  lastReadAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReadingProgress {
  id: string;                    // `${studentId}_${bookId}`
  studentId: string;
  bookId: string;                // Foreign key to Book.id
  lastPage: number;              // Last page viewed (1-indexed)
  lastCfi?: string;              // For EPUB: CFI location string
  completionPercentage: number;  // 0-100
  lastReadAt: Date;
  totalReadingTime: number;      // In seconds
}

export interface ReadingNote {
  id?: number;
  studentId: string;
  bookId: string;
  page: number;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Bookmark {
  id?: number;
  studentId: string;
  bookId: string;
  cfi: string;
  textSnippet: string;
  chapterName: string;
  createdAt: Date;
}

export interface DownloadChunk {
  id: string;                    // `${bookId}_${chunkIndex}`
  bookId: string;
  chunkIndex: number;
  startByte: number;
  endByte: number;
  data: ArrayBuffer;
  downloadedAt: Date;
}

export interface UserSettings {
  id: string;                    // Always 'settings' (singleton)
  userId?: string;               // Firebase UID when logged in
  ttsRate: number;               // Speech rate (0.5 - 2.0)
  ttsVoice?: string;             // Preferred device voice name
  theme: 'light' | 'dark' | 'sepia';
  fontSize: number;              // For EPUB rendering
  lastSyncAt?: Date;
  lastImportedVersion?: string;  // Track GitHub pack version
  librarySyncUrl?: string;       // Hosted pack version.json URL
  // License fields
  licenseKey?: string;
  licenseSchool?: string;
  licenseLab?: string;
  licenseDeviceId?: string;
  licenseIssuedAt?: string;
  licenseExpiresAt?: string;
}

// ============================================================================
// DATABASE CLASS
// ============================================================================

class InvronLibraryDB extends Dexie {
  books!: EntityTable<Book, 'id'>;
  userProgress!: EntityTable<ReadingProgress, 'id'>;
  downloadChunks!: EntityTable<DownloadChunk, 'id'>;
  settings!: EntityTable<UserSettings, 'id'>;
  readingNotes!: EntityTable<ReadingNote, 'id'>;
  bookmarks!: EntityTable<Bookmark, 'id'>;

  constructor() {
    super('InvronLibraryDB');

    this.version(1).stores({
      // Primary key first, then indexed fields
      books: 'id, title, type, language, isBundled, downloadStatus, *categories',
      readingProgress: 'bookId, lastReadAt',
      downloadChunks: 'id, bookId, chunkIndex',
      settings: 'id'
    });

    this.version(2).stores({
      books: 'id, title, type, language, isBundled, downloadStatus, *categories',
      readingProgress: 'bookId, lastReadAt',
      downloadChunks: 'id, bookId, chunkIndex',
      settings: 'id',
      readingNotes: '++id, bookId, page, createdAt'
    });

    this.version(3).stores({
      books: 'id, title, type, language, isBundled, downloadStatus, *categories, *assignedToUsers',
      readingProgress: 'bookId, lastReadAt',
      downloadChunks: 'id, bookId, chunkIndex',
      settings: 'id',
      readingNotes: '++id, bookId, page, createdAt'
    }).upgrade(tx => {
      // Initialize the array for existing downloaded books so they aren't orphaned
      return tx.table('books').toCollection().modify(book => {
        if (!book.assignedToUsers) {
          book.assignedToUsers = [];
        }
      });
    });

    this.version(4).stores({
      books: 'id, title, type, language, isBundled, downloadStatus, *categories, *assignedToUsers',
      readingProgress: 'bookId, lastReadAt',
      downloadChunks: 'id, bookId, chunkIndex',
      settings: 'id',
      readingNotes: '++id, bookId, page, createdAt',
      bookmarks: '++id, bookId, cfi, createdAt'
    });

    this.version(5).stores({
      books: 'id, title, type, language, isBundled, downloadStatus, *categories, *assignedToUsers',
      readingProgress: null, // explicitly drop the old table
      userProgress: 'id, studentId, bookId, lastReadAt',
      downloadChunks: 'id, bookId, chunkIndex',
      settings: 'id',
      readingNotes: '++id, studentId, bookId, page, createdAt',
      bookmarks: '++id, studentId, bookId, cfi, createdAt'
    });
  }
}

// ============================================================================
// DATABASE INSTANCE (Singleton)
// ============================================================================

export const db = new InvronLibraryDB();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Request persistent storage to prevent browser from evicting our data
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    console.log(`[DB] Persistent storage granted: ${isPersisted}`);
    return isPersisted;
  }
  return false;
}

/**
 * Get storage usage estimate
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0
    };
  }
  return null;
}

/**
 * Check if TTS is available for a book (English only)
 */
export function isTTSEnabled(book: Book): boolean {
  const lang = (book.language || '').toLowerCase();
  // Enable TTS for English books, or when language is unset (default to enabled for EPUB)
  return lang === '' || lang === 'en' || lang.startsWith('en-');
}

// ============================================================================
// NOTES HELPERS
// ============================================================================

export async function getNotesForBook(bookId: string): Promise<ReadingNote[]> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  return db.readingNotes
    .where({ studentId, bookId })
    .sortBy('createdAt');
}

export async function addNoteForBook(bookId: string, page: number, text: string): Promise<ReadingNote> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  const note: ReadingNote = {
    studentId,
    bookId,
    page,
    text,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const id = await db.readingNotes.add(note);
  return { ...note, id };
}

export async function deleteNoteById(noteId: number): Promise<void> {
  await db.readingNotes.delete(noteId);
}

// ============================================================================
// BOOKMARK HELPERS
// ============================================================================

export async function getBookmarksForBook(bookId: string): Promise<Bookmark[]> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  return db.bookmarks
    .where({ studentId, bookId })
    .sortBy('createdAt');
}

export async function addBookmark(bookId: string, cfi: string, textSnippet: string, chapterName: string): Promise<number> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  const id = await db.bookmarks.add({
    studentId,
    bookId,
    cfi,
    textSnippet,
    chapterName,
    createdAt: new Date()
  });
  return id as number;
}

export async function removeBookmark(id: number): Promise<void> {
  await db.bookmarks.delete(id);
}

export async function isBookmarked(bookId: string, cfi: string): Promise<boolean> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  // exact cfi match might be brittle structurally, but good enough for exact position
  const match = await db.bookmarks.where({ studentId, bookId, cfi }).first();
  return !!match;
}

/**
 * Get or create default user settings
 */
export async function getSettings(): Promise<UserSettings> {
  let settings = await db.settings.get('settings');

  if (!settings) {
    settings = {
      id: 'settings',
      ttsRate: 1.0,
      theme: 'light',
      fontSize: 16
    };
    await db.settings.put(settings);
  }

  return settings;
}

/**
 * Update user settings
 */
export async function updateSettings(updates: Partial<UserSettings>): Promise<void> {
  await db.settings.update('settings', updates);
}

/**
 * Get reading progress for a book
 */
export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  const progId = `${studentId}_${bookId}`;
  return db.userProgress.get(progId);
}

/**
 * Update reading progress
 */
export async function updateProgress(
  bookId: string,
  page: number,
  cfi?: string,
  totalPages?: number,
  completionPercentage?: number
): Promise<void> {
  const session = await getClientSession();
  const studentId = session ? session.id : 'HOST';
  const progId = `${studentId}_${bookId}`;

  const existing = await db.userProgress.get(progId);
  // Use provided percentage, or calculate from pages, or keep existing
  const percentage = completionPercentage ?? (totalPages ? Math.round((page / totalPages) * 100) : existing?.completionPercentage ?? 0);

  if (existing) {
    await db.userProgress.update(progId, {
      lastPage: page,
      lastCfi: cfi,
      completionPercentage: Math.min(100, Math.max(0, percentage)),
      lastReadAt: new Date()
    });
  } else {
    await db.userProgress.add({
      id: progId,
      studentId,
      bookId,
      lastPage: page,
      lastCfi: cfi,
      completionPercentage: Math.min(100, Math.max(0, percentage)),
      lastReadAt: new Date(),
      totalReadingTime: 0
    });
  }
}

/**
 * Update the last read timestamp for a book
 */
export async function updateLastReadAt(bookId: string): Promise<void> {
  await db.books.update(bookId, {
    lastReadAt: new Date(),
    updatedAt: new Date()
  });
}

export default db;
