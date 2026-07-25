/**
 * Invro Libera - Library Browser Page
 * Browse, filter, and search books in the library
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, type Book } from '../db';
import { requestLocalNotificationPermission, sendLocalNotification } from '../services/localNotifications';
import { getClientSession } from '../services/localAuth';

async function loadCatalogSync() {
  return import('../services/catalogSync');
}

// ============================================================================
// TYPES
// ============================================================================

type ViewMode = 'grid' | 'list';
type SortOption = 'recent' | 'title' | 'author';

// Extended book type for display
interface DisplayBook extends Book {
  isFavorite?: boolean;
}

interface LibraryBrowserProps {
  searchQuery?: string;
  onOpenBook: (book: Book) => void;
  onToggleFavorite?: (bookId: string) => void;
}



// ============================================================================
// COMPONENT
// ============================================================================

export default function LibraryBrowser({ searchQuery = '', onOpenBook, onToggleFavorite }: LibraryBrowserProps) {
  const [books, setBooks] = useState<DisplayBook[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Derive categories dynamically from loaded books
  const categories = useMemo(() => {
    const catSet = new Set<string>();
    books.forEach(book => {
      book.categories?.forEach(c => {
        const cat = c.trim().toLowerCase();
        if (cat && cat !== 'all' && cat !== 'general') {
          catSet.add(c.trim());
        }
      });
    });
    // Sort alphabetically, prepend "All"
    const sorted = [...catSet].sort((a, b) => a.localeCompare(b));
    return [
      { id: 'all', label: 'All' },
      ...sorted.map(c => ({ id: c.toLowerCase(), label: c.charAt(0).toUpperCase() + c.slice(1) }))
    ];
  }, [books]);

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    try {
      const session = await getClientSession();
      const userClass = session?.classId;

      const rawBooks = await db.books.toArray();
      const allBooks = rawBooks.filter((book: Book & { hidden?: boolean; assigned_class?: string }) => {
          if (book.hidden) return false;
          if (book.assigned_class && book.assigned_class.trim() !== '') {
              if (book.assigned_class !== userClass) return false;
          }
          return true;
      });

      const displayBooks: DisplayBook[] = allBooks.map((book: Book) => ({
        ...book,
        isFavorite: false // Default, can be loaded from localStorage or db
      }));

      setBooks(displayBooks);

      // Load favorites from localStorage
      const savedFavorites = localStorage.getItem('invro-libera-favorites');
      if (savedFavorites) {
        try {
          const favIds = JSON.parse(savedFavorites) as string[];
          setFavorites(new Set(favIds));
        } catch {
          console.error('[LibraryBrowser] Failed to parse favorites');
        }
      }
    } catch (error) {
      console.error('[LibraryBrowser] Failed to load books:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ==========================================================================
  // MANUAL REFRESH (rate-limited to 60s)
  // ==========================================================================

  const handleManualSync = useCallback(async () => {
    void requestLocalNotificationPermission();

    // Rate limit: 60 seconds
    const lastSync = sessionStorage.getItem('invro_last_manual_sync');
    if (lastSync && Date.now() - Number(lastSync) < 60_000) {
      const remaining = Math.ceil((60_000 - (Date.now() - Number(lastSync))) / 1000);
      setSyncStatus(`Please wait ${remaining}s before refreshing again`);
      setTimeout(() => setSyncStatus(null), 3000);
      return;
    }

    setIsSyncing(true);
    setSyncStatus('Syncing...');

    try {
      const { syncCatalogForUser } = await loadCatalogSync();
      await syncCatalogForUser();
      const { performAutoUpdate } = await import('../services/githubPackSync');
      await performAutoUpdate();

      sessionStorage.setItem('invro_last_manual_sync', String(Date.now()));
      await loadBooks();
      setSyncStatus('Library up to date');
      sendLocalNotification('Library sync complete', {
        body: 'Your assigned library is up to date on this device.',
        tag: 'library-sync-success',
      });
    } catch (err) {
      console.error('[LibraryBrowser] Manual sync failed:', err);
      const { formatCatalogSyncError } = await loadCatalogSync();
      const message = formatCatalogSyncError(err);
      setSyncStatus(`Sync failed: ${message}`);
      sendLocalNotification('Library sync failed', {
        body: message,
        tag: 'library-sync-failed',
        requireInteraction: true,
      });
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatus(null), 3000);
    }
  }, []);

  const handleToggleFavorite = async (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    const newFavorites = new Set(favorites);
    if (newFavorites.has(bookId)) {
      newFavorites.delete(bookId);
    } else {
      newFavorites.add(bookId);
    }
    setFavorites(newFavorites);

    // Save favorites to localStorage
    localStorage.setItem('invro-libera-favorites', JSON.stringify([...newFavorites]));
    onToggleFavorite?.(bookId);
  };

  // Filter and sort books
  const filteredBooks = useMemo(() => {
    let result = [...books];

    // Filter by category
    if (activeCategory !== 'all') {
      result = result.filter(b =>
        b.categories?.some(c => c.toLowerCase() === activeCategory.toLowerCase())
      );
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(b =>
        b.title.toLowerCase().includes(query) ||
        b.author.toLowerCase().includes(query) ||
        (b.categories?.some(c => c.toLowerCase().includes(query)))
      );
    }

    // Sort
    switch (sortBy) {
      case 'title':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'author':
        result.sort((a, b) => a.author.localeCompare(b.author));
        break;
      case 'recent':
      default:
        result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        break;
    }

    return result;
  }, [books, activeCategory, searchQuery, sortBy]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 sm:p-6 lg:p-8 space-y-4 sm:space-y-6 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Library</h2>

        <div className="flex flex-wrap items-center gap-2 sm:gap-4 w-full sm:w-auto">
          {/* Import .invronpack Button */}
          <button
            onClick={async () => {
              try {
                const { open } = await import('@tauri-apps/plugin-dialog');
                const { invoke } = await import('@tauri-apps/api/core');
                const selected = await open({
                  multiple: false,
                  filters: [{ name: 'Invron Package', extensions: ['invronpack'] }]
                });
                if (selected && typeof selected === 'string') {
                  setSyncStatus('Importing package...');
                  const imported = await invoke<{ id: string; title: string }[]>('import_invronpack', { filePath: selected });
                  await loadBooks();
                  setSyncStatus(`Imported ${imported.length} book(s)`);
                  setTimeout(() => setSyncStatus(null), 3000);
                }
              } catch (err: any) {
                console.error('[LibraryBrowser] Package import error:', err);
                setSyncStatus(`Import error: ${err.toString()}`);
                setTimeout(() => setSyncStatus(null), 4000);
              }
            }}
            className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition whitespace-nowrap shadow-xs"
            title="Import offline .invronpack package"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            Import Pack
          </button>

          {/* Refresh Button */}
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="flex-1 sm:flex-none justify-center flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium rounded-lg border border-slate-200 bg-white dark:bg-neutral-800 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            title="Refresh library from cloud"
          >
            <span className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}>
              sync
            </span>
            {isSyncing ? 'Syncing...' : 'Sync Cloud'}
          </button>

          {/* Sync Status Toast */}
          {syncStatus && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 hidden sm:inline">{syncStatus}</span>
          )}

          {/* Sort Dropdown */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="flex-1 sm:flex-none bg-white dark:bg-neutral-800 border border-slate-200 rounded-lg px-2 sm:px-3 py-2 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary text-slate-700 min-w-[120px]"
          >
            <option value="recent">Recently Added</option>
            <option value="title">Title A-Z</option>
            <option value="author">Author A-Z</option>
          </select>

          {/* View Toggle */}
          <div className="flex bg-slate-100 dark:bg-neutral-700 rounded-lg p-1 shrink-0">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white dark:bg-neutral-600 shadow-sm' : ''}`}
            >
              <span className={`material-symbols-outlined text-[20px] ${viewMode === 'grid' ? 'text-primary' : 'text-slate-400'}`}>
                grid_view
              </span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white dark:bg-neutral-600 shadow-sm' : ''}`}
            >
              <span className={`material-symbols-outlined text-[20px] ${viewMode === 'list' ? 'text-primary' : 'text-slate-400'}`}>
                view_list
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Category Chips */}
      <div className="flex gap-2 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-full transition whitespace-nowrap ${activeCategory === cat.id
              ? 'bg-primary/10 text-primary border border-primary/30'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent'
              }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Results Count */}
      <p className="text-xs sm:text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{filteredBooks.length}</span> books
        {searchQuery && <span> matching "{searchQuery}"</span>}
      </p>

      {/* Books Grid/List */}
      {filteredBooks.length === 0 ? (
        <div className="text-center py-12 sm:py-16">
          <span className="material-symbols-outlined text-5xl sm:text-6xl text-slate-300 mb-4 block">
            library_books
          </span>
          <h3 className="text-lg sm:text-xl font-semibold text-slate-600 mb-2">No books found</h3>
          <p className="text-sm text-slate-500">Try adjusting your filters or search query</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
          {filteredBooks.map((book) => (
            <div
              key={book.id}
              onClick={() => onOpenBook(book)}
              className="group cursor-pointer"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-slate-200 mb-2 sm:mb-3 shadow-sm group-hover:shadow-lg transition-all">
                {/* Cover Image */}
                <div
                  className="w-full h-full bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                  style={book.coverUrl ? { backgroundImage: `url('${book.coverUrl}')` } : undefined}
                >
                  {!book.coverUrl && (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-4xl sm:text-5xl text-slate-400">menu_book</span>
                    </div>
                  )}
                </div>

                {/* Overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                  <button className="text-white text-xs sm:text-sm font-medium flex items-center gap-1">
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    Read Now
                  </button>
                </div>

                {/* Favorite Button */}
                <button
                  onClick={(e) => handleToggleFavorite(e, book.id)}
                  className="absolute top-2 right-2 size-7 sm:size-8 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:scale-110"
                >
                  <span className={`material-symbols-outlined text-[16px] sm:text-[18px] ${favorites.has(book.id) ? 'text-red-500' : 'text-slate-400'}`}>
                    {favorites.has(book.id) ? 'favorite' : 'favorite_border'}
                  </span>
                </button>

                {/* Downloaded Badge */}
                {(book.downloadStatus === 'complete' || book.isBundled) && (
                  <div className="absolute top-2 left-2 size-5 sm:size-6 rounded-full bg-emerald-500 flex items-center justify-center">
                    <span className="material-symbols-outlined text-[12px] sm:text-[14px] text-white">download_done</span>
                  </div>
                )}
              </div>

              {/* Book Info */}
              <h5 className="font-semibold text-sm sm:text-base text-slate-900 truncate">{book.title}</h5>
              <p className="text-xs sm:text-sm text-slate-500 truncate">{book.author}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredBooks.map((book) => (
            <div
              key={book.id}
              onClick={() => onOpenBook(book)}
              className="flex items-center gap-3 sm:gap-4 bg-white p-3 sm:p-4 rounded-xl border border-slate-100 hover:shadow-md transition cursor-pointer"
            >
              {/* Cover */}
              <div
                className="w-14 h-20 sm:w-16 sm:h-24 shrink-0 rounded-lg bg-cover bg-center bg-slate-200"
                style={book.coverUrl ? { backgroundImage: `url('${book.coverUrl}')` } : undefined}
              >
                {!book.coverUrl && (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-3xl text-slate-400">menu_book</span>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <h5 className="font-semibold text-sm sm:text-base text-slate-900 truncate">{book.title}</h5>
                <p className="text-xs sm:text-sm text-slate-500">{book.author}</p>
                <div className="flex items-center gap-3 mt-1 sm:mt-2 text-[10px] sm:text-xs text-slate-400">
                  <span className="uppercase">{book.type}</span>
                  {book.language && <span className="uppercase">{book.language}</span>}
                  {book.fileSize && <span>{(book.fileSize / 1024 / 1024).toFixed(1)} MB</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => handleToggleFavorite(e, book.id)}
                  className="p-1.5 sm:p-2 rounded-lg hover:bg-slate-100"
                >
                  <span className={`material-symbols-outlined text-[20px] ${favorites.has(book.id) ? 'text-red-500' : 'text-slate-400'}`}>
                    {favorites.has(book.id) ? 'favorite' : 'favorite_border'}
                  </span>
                </button>
                {(book.downloadStatus === 'complete' || book.isBundled) && (
                  <span className="material-symbols-outlined text-[20px] text-emerald-500">download_done</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination (if needed) */}
      {filteredBooks.length > 20 && (
        <div className="flex justify-center gap-2 mt-6">
          <button className="px-4 py-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-medium">
            Previous
          </button>
          <button className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium">
            1
          </button>
          <button className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
            2
          </button>
          <button className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
            3
          </button>
          <button className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm font-medium">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
