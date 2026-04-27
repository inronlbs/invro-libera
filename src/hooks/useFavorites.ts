import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  readFavorites,
  setFavorites,
  subscribeFavorites,
  toggleFavorite
} from '../services/favoritesStore';

const getSnapshot = () => readFavorites();

export function useFavorites() {
  const favoritesArray = useSyncExternalStore(
    subscribeFavorites,
    getSnapshot,
    getSnapshot
  );

  const favorites = useMemo(() => new Set(favoritesArray), [favoritesArray]);

  const handleToggle = useCallback((bookId: string) => {
    toggleFavorite(bookId);
  }, []);

  const removeFavorite = useCallback((bookId: string) => {
    const next = new Set(favorites);
    next.delete(bookId);
    setFavorites(next);
  }, [favorites]);

  const clearFavorites = useCallback(() => {
    setFavorites(new Set());
  }, []);

  const isFavorite = useCallback((bookId: string) => favorites.has(bookId), [favorites]);

  return {
    favorites,
    favoritesArray,
    toggleFavorite: handleToggle,
    removeFavorite,
    clearFavorites,
    isFavorite
  };
}
