/**
 * Invron E-Library - Library View Component
 * 
 * Main library grid displaying all books
 */

import { useState, useEffect, useMemo } from 'react';
import db, { type Book } from '../../db';
import BookCard from './BookCard';
import './Library.css';

// ============================================================================
// TYPES
// ============================================================================

interface LibraryProps {
  onOpenBook: (book: Book) => void;
}


type SortOption = 'title' | 'author' | 'recent';

// ============================================================================
// COMPONENT
// ============================================================================

export default function Library({ onOpenBook }: LibraryProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('title');

  // ==========================================================================
  // DATA LOADING
  // ==========================================================================

  useEffect(() => {
    const loadBooks = async () => {
      try {
        const allBooks = await db.books.toArray();
        setBooks(allBooks);
      } catch (error) {
        console.error('[Library] Failed to load books:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadBooks();

    // Subscribe to database changes
    db.books.hook('creating', () => {
      loadBooks();
    });

    return () => {
      // Cleanup subscription
    };
  }, []);

  // ==========================================================================
  // FILTERING & SORTING
  // ==========================================================================

  const filteredBooks = useMemo(() => {
    const result = [...books];

    // Sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'author':
          return a.author.localeCompare(b.author);
        case 'recent':
          return b.updatedAt.getTime() - a.updatedAt.getTime();
        case 'title':
        default:
          return a.title.localeCompare(b.title);
      }
    });

    return result;
  }, [books, sortBy]);

  // ==========================================================================
  // RENDER
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="library-loading">
        <div className="spinner"></div>
        <p>Loading your library...</p>
      </div>
    );
  }

  return (
    <div className="library">
      {/* Stats Bar */}
      <div className="library-stats">
        <div className="stat-item">
          <span className="stat-value">{books.length}</span>
          <span className="stat-label">Total Books</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="library-filters">

        <div className="filter-actions">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="sort-select"
          >
            <option value="title">Sort by Title</option>
            <option value="author">Sort by Author</option>
            <option value="recent">Sort by Recent</option>
          </select>

          <div className="view-toggle">
            <button className="view-btn active" title="Grid View">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
            </button>
            <button className="view-btn" title="List View">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Book Grid */}
      {filteredBooks.length > 0 ? (
        <div className="book-grid">
          {filteredBooks.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={onOpenBook}
            />
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <span className="empty-icon">📚</span>
          <p>Your library is empty</p>
          <p className="empty-hint">Books will appear here once added by your school.</p>
        </div>
      )}
    </div>
  );
}
