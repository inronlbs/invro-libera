const STORAGE_KEY = 'invro-libera-favorites';

type Listener = () => void;

const listeners = new Set<Listener>();

// Cache the current snapshot to prevent infinite loops in useSyncExternalStore
let cachedSnapshot: string[] = [];

const readFromStorage = (): string[] => {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Initialize cache on module load
if (typeof window !== 'undefined') {
  cachedSnapshot = readFromStorage();
  
  // Cross-tab synchronization
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      cachedSnapshot = readFromStorage();
      emit();
    }
  });
}

const writeToStorage = (ids: string[]): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Ignore quota errors for now
  }
};

const emit = () => {
  listeners.forEach((listener) => listener());
};

export const subscribeFavorites = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Return the cached snapshot (same reference unless changed)
export const readFavorites = (): string[] => cachedSnapshot;

export const readFavoritesSet = (): Set<string> => new Set(cachedSnapshot);

export const setFavorites = (ids: Set<string>): void => {
  const arr = Array.from(ids);
  cachedSnapshot = arr; // Update cache
  writeToStorage(arr);
  emit();
};

export const toggleFavorite = (bookId: string): void => {
  const current = readFavoritesSet();
  if (current.has(bookId)) {
    current.delete(bookId);
  } else {
    current.add(bookId);
  }
  setFavorites(current);
};

export const isFavoriteId = (bookId: string): boolean => readFavoritesSet().has(bookId);
