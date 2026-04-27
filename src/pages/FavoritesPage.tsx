import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { liveQuery } from 'dexie';
import db, { type Book } from '../db';
import { useFavorites } from '../hooks/useFavorites';
import { navPageToPath } from '../navigation';

// ============================================================================
// TYPES & HELPERS
// ============================================================================

interface FavoritesPageProps {
  onOpenBook: (book: Book) => void;
}

const formatBytes = (bytes: number | undefined): string => {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb < 1 ? mb.toFixed(2) : mb.toFixed(1)} MB`;
};

const formatDate = (date: Date | undefined): string => {
  if (!date) return 'Unknown';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function FavoritesPage({ onOpenBook }: FavoritesPageProps) {
  const navigate = useNavigate();
  const { favorites, toggleFavorite } = useFavorites();
  const [favoriteBooks, setFavoriteBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getActivityTimestamp = (book: Book) => {
    const date = book.lastReadAt ?? book.updatedAt;
    return date ? date.getTime() : 0;
  };

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    const syncFavorites = async () => {
      if (favorites.size === 0) {
        if (!cancelled) {
          setFavoriteBooks([]);
          setError(null);
          setIsLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setIsLoading(true);
      }

      const ids = Array.from(favorites);
      const subscription = liveQuery(() => db.books.where('id').anyOf(ids).toArray()).subscribe({
        next: (rows) => {
          if (cancelled) return;
          const sorted = rows.sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));
          setFavoriteBooks(sorted);
          setIsLoading(false);
          setError(null);
        },
        error: (err) => {
          if (cancelled) return;
          console.error('[FavoritesPage] Failed to load favorites', err);
          setError('Unable to load favorites right now.');
          setIsLoading(false);
        }
      });

      unsubscribe = () => subscription.unsubscribe();
    };

    void syncFavorites();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [favorites]);

  const pinned = useMemo(() => favoriteBooks.slice(0, 2), [favoriteBooks]);
  const shelf = useMemo(() => favoriteBooks.slice(2), [favoriteBooks]);

  const stats = useMemo(() => {
    const total = favoriteBooks.length;
    const completed = favoriteBooks.filter((book) => book.downloadStatus === 'complete' || book.isBundled).length;
    const totalSize = favoriteBooks.reduce((sum, book) => sum + (book.downloadedBytes || book.fileSize || 0), 0);
    const subjects = new Set<string>();
    favoriteBooks.forEach((book) => book.categories?.forEach((c) => subjects.add(c)));

    return {
      total,
      completed,
      totalSize,
      subjects: subjects.size
    };
  }, [favoriteBooks]);

  const renderEmptyState = () => (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="material-symbols-outlined">favorite</span>
      </div>
      <h3 className="text-xl font-semibold text-slate-900">No favorite titles yet</h3>
      <p className="mt-2 text-sm text-slate-500">
        Tap the heart icon on any book in your library to pin it here for quick access.
      </p>
      <button
        onClick={() => navigate(navPageToPath['library'])}
        className="mt-6 rounded-full bg-primary px-6 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
      >
        Explore Library
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 sm:gap-8 p-4 sm:p-6 lg:p-8 pb-8">
      <header className="flex flex-col gap-1 sm:gap-2">
        <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-[0.3em] text-secondary">Curated</p>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Favorites</h1>
        <p className="text-xs sm:text-sm text-slate-500">Your hand-picked reading list, synced across devices.</p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 sm:px-4 sm:py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {favoriteBooks.length === 0 ? (
        renderEmptyState()
      ) : (
        <>
          {/* Stats */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-widest text-slate-400">Pinned Titles</p>
              <p className="mt-0.5 sm:mt-1 text-xl sm:text-2xl font-bold text-slate-900">{stats.total}</p>
            </div>
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-widest text-slate-400">Offline Ready</p>
              <p className="mt-0.5 sm:mt-1 text-xl sm:text-2xl font-bold text-slate-900">{stats.completed}</p>
            </div>
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-widest text-slate-400">Subjects</p>
              <p className="mt-0.5 sm:mt-1 text-xl sm:text-2xl font-bold text-slate-900">{stats.subjects}</p>
            </div>
            <div>
              <p className="text-[10px] sm:text-xs uppercase tracking-widest text-slate-400">Storage</p>
              <p className="mt-0.5 sm:mt-1 text-xl sm:text-2xl font-bold text-slate-900">{formatBytes(stats.totalSize)}</p>
            </div>
          </section>

          {/* Featured favorites */}
          {!!pinned.length && (
            <section className="flex flex-col gap-3 sm:gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">Priority Picks</h2>
                <span className="text-[10px] sm:text-xs font-medium text-slate-500">Auto-sorted by recent activity</span>
              </div>
              <div className="grid gap-4 grid-cols-2 xl:grid-cols-3">
                {pinned.map((book) => (
                  <article
                    key={book.id}
                    className="flex flex-col gap-3 sm:gap-4 rounded-xl sm:rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="h-24 sm:h-28 w-16 sm:w-20 shrink-0 overflow-hidden rounded-lg sm:rounded-xl bg-slate-200 bg-cover bg-center shadow-sm"
                        style={book.coverUrl ? { backgroundImage: `url('${book.coverUrl}')` } : undefined}
                      >
                        {!book.coverUrl && (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <span className="material-symbols-outlined text-3xl">menu_book</span>
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">{book.title}</h3>
                            <p className="text-sm text-slate-500">{book.author}</p>
                          </div>
                          <button
                            onClick={() => toggleFavorite(book.id)}
                            className="rounded-full p-2 text-red-500 hover:bg-red-50"
                            title="Remove from favorites"
                          >
                            <span className="material-symbols-outlined">favorite</span>
                          </button>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                          {book.categories?.slice(0, 3).map((category) => (
                            <span key={category} className="rounded-full bg-slate-100 px-2 py-0.5">
                              {category}
                            </span>
                          ))}
                          <span>{formatBytes(book.downloadedBytes || book.fileSize)}</span>
                          <span>Last read {formatDate(book.lastReadAt ?? book.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => onOpenBook(book)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
                      >
                        <span className="material-symbols-outlined text-[18px]">menu_book</span>
                        Continue
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Shelf */}
          {shelf.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Favorite Shelf</h2>
                <button
                  onClick={() => navigate(navPageToPath['library'])}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  View Library
                </button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                {shelf.map((book, index) => (
                  <div
                    key={book.id}
                    className={`flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center ${index !== shelf.length - 1 ? 'border-b border-slate-100' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-16 overflow-hidden rounded-lg bg-slate-200 bg-cover bg-center shadow-sm">
                        {book.coverUrl ? (
                          <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url('${book.coverUrl}')` }} />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-slate-400">
                            <span className="material-symbols-outlined text-3xl">menu_book</span>
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{book.title}</h3>
                        <p className="text-sm text-slate-500">{book.author}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          <span>{formatBytes(book.downloadedBytes || book.fileSize)}</span>
                          <span>Last read {formatDate(book.lastReadAt ?? book.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => onOpenBook(book)}
                        className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary/90"
                      >
                        <span className="material-symbols-outlined text-[18px]">menu_book</span>
                        Read
                      </button>
                      <button
                        onClick={() => toggleFavorite(book.id)}
                        className="flex size-10 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-colors hover:text-red-500"
                        title="Remove from favorites"
                      >
                        <span className="material-symbols-outlined text-[20px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
