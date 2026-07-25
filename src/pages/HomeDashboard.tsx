/**
 * Invro Libera - Home Dashboard Page
 * Welcome screen with stats, continue reading, and categorized book browsing
 */

import { useState, useEffect, useMemo } from 'react';
import db, { type Book, type ReadingProgress } from '../db';
import HorizontalScroll from '../components/common/HorizontalScroll';
import { getClientSession } from '../services/localAuth';
// ============================================================================
// TYPES
// ============================================================================

interface HomeDashboardProps {
  userName?: string;
  onOpenBook: (book: Book) => void;
  searchQuery?: string;
}

interface BookWithProgress extends Book {
  progress?: number;
  lastChapter?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function formatDate(): string {
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
  return new Date().toLocaleDateString('en-US', options);
}



// ============================================================================
// COMPONENT
// ============================================================================

export default function HomeDashboard({ userName = 'Reader', onOpenBook, searchQuery = '' }: HomeDashboardProps) {
  const [recentBooks, setRecentBooks] = useState<BookWithProgress[]>([]);
  const [allBooks, setAllBooks] = useState<Book[]>([]);
  const [stats, setStats] = useState({ streak: 0, completed: 0, hoursRead: 0 });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const session = await getClientSession();
      const userClass = session?.classId;

      const rawBooks = await db.books.toArray();
      const visibleBooks = rawBooks.filter((book: Book & { hidden?: boolean; assigned_class?: string }) => {
          if (book.hidden) return false;
          if (book.assigned_class && book.assigned_class.trim() !== '') {
              if (book.assigned_class !== userClass) return false;
          }
          return true;
      });

      setAllBooks(visibleBooks);

      // Get reading progress for the current student
      const currentStudentId = session ? session.id : 'HOST';
      const progress = await db.userProgress.where('studentId').equals(currentStudentId).toArray();
      const progressMap = new Map<string, ReadingProgress>(progress.map((p: ReadingProgress) => [p.bookId, p]));

      // Recent books with progress
      const booksWithProgress: BookWithProgress[] = visibleBooks
        .filter((book: Book) => progressMap.has(book.id))
        .map((book: Book) => {
          const p = progressMap.get(book.id);
          return {
            ...book,
            progress: p?.completionPercentage || 0,
            lastChapter: p?.lastPage ? `Page ${p.lastPage}` : 'Starting'
          };
        })
        .sort((a: BookWithProgress, b: BookWithProgress) => {
          const aProgress = progressMap.get(a.id);
          const bProgress = progressMap.get(b.id);
          return (bProgress?.lastReadAt?.getTime() || 0) - (aProgress?.lastReadAt?.getTime() || 0);
        })
        .slice(0, 5);

      setRecentBooks(booksWithProgress);

      // Calculate real stats from reading progress
      const completedBooks = progress.filter((p: ReadingProgress) => p.completionPercentage >= 100).length;

      const totalPagesRead = progress.reduce((sum: number, p: ReadingProgress) => {
        const pagesRead = (p.lastPage || 0) * ((p.completionPercentage || 0) / 100);
        return sum + pagesRead;
      }, 0);
      const hoursRead = Math.round((totalPagesRead * 2) / 60);

      const today = new Date();
      const daysWithActivity = new Set<string>();
      progress.forEach((p: ReadingProgress) => {
        if (p.lastReadAt) {
          const dateKey = p.lastReadAt.toISOString().split('T')[0];
          daysWithActivity.add(dateKey);
        }
      });

      let streak = 0;
      for (let i = 0; i < 365; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        const dateKey = checkDate.toISOString().split('T')[0];
        if (daysWithActivity.has(dateKey)) {
          streak++;
        } else if (i > 0) {
          break;
        }
      }

      setStats({
        streak: streak,
        completed: completedBooks,
        hoursRead: hoursRead || 0
      });
    } catch (error) {
      console.error('[HomeDashboard] Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter all books by search
  const filteredBooks = useMemo(() => {
    if (!searchQuery.trim()) return allBooks;
    const q = searchQuery.toLowerCase();
    return allBooks.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q) ||
      (b.categories?.some(c => c.toLowerCase().includes(q)))
    );
  }, [allBooks, searchQuery]);

  // Filter recent books by search
  const filteredRecentBooks = useMemo(() => {
    if (!searchQuery.trim()) return recentBooks;
    const q = searchQuery.toLowerCase();
    return recentBooks.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q)
    );
  }, [recentBooks, searchQuery]);

  // Determine a featured reading suggestion (pick a highly rated or random book they haven't started)
  const featuredSuggestion = useMemo(() => {
    if (allBooks.length === 0) return null;
    const unread = allBooks.filter(b => !recentBooks.find(r => r.id === b.id));
    if (unread.length > 0) {
      // Pick a random unread book each day (using today's date as stable seed)
      const dayIndex = new Date().getDate();
      return unread[dayIndex % unread.length];
    }
    return allBooks[0];
  }, [allBooks, recentBooks]);

  // "Student Favorites" - stable random selection of 6 books
  const studentFavorites = useMemo(() => {
    return [...filteredBooks]
      .sort((a, b) => {
        const seed = new Date().getDate() + 5; // Offset seed
        return ((a.id.charCodeAt(0) + seed) % 10) - ((b.id.charCodeAt(0) + seed) % 10);
      })
      .slice(0, 6);
  }, [filteredBooks]);

  // "Top Picks" - randomized but stable per day (excluding favorites to avoid dups)
  const topPicks = useMemo(() => {
    return [...filteredBooks]
      .filter(b => b.id !== featuredSuggestion?.id && !studentFavorites.find(f => f.id === b.id))
      .sort((a, b) => {
        // Pseudo-random sort using the book ID and today's date
        const seed = new Date().getDate();
        const aVal = (a.id.charCodeAt(0) + seed) % 10;
        const bVal = (b.id.charCodeAt(0) + seed) % 10;
        return aVal - bVal;
      })
      .slice(0, 12);
  }, [filteredBooks, featuredSuggestion, studentFavorites]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="max-w-[1200px] w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-8 sm:gap-10 pb-8">
      {/* Welcome Banner */}
      {!isSearching && (
        <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-slate-900">
              {getGreeting()}, {userName}
            </h2>
            <p className="text-slate-500 text-base sm:text-lg">
              Ready to continue your adventure?
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-3 w-full md:w-auto">
            <div className="hidden md:block text-right">
              <p className="text-sm font-medium text-slate-900">{formatDate()}</p>
              <p className="text-xs text-slate-500">Keep up the great work!</p>
            </div>
          </div>
        </section>
      )}

      {/* Search Results Header */}
      {isSearching && (
        <section>
          <p className="text-sm text-slate-500">
            Found <span className="font-semibold text-slate-700">{filteredBooks.length}</span> books matching "<span className="font-medium">{searchQuery}</span>"
          </p>
        </section>
      )}

      {/* Quick Stats */}
      {!isSearching && (
        <section className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-white p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 sm:gap-4 col-span-2 md:col-span-1">
            <div className="size-10 sm:size-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px] sm:text-[24px]">local_fire_department</span>
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900">{stats.streak} Days</p>
              <p className="text-xs sm:text-sm text-slate-500">Current Streak</p>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 sm:gap-4">
            <div className="size-10 sm:size-12 rounded-full bg-[#1f70af]/10 text-[#1f70af] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px] sm:text-[24px]">import_contacts</span>
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900">{stats.completed} Books</p>
              <p className="text-xs sm:text-sm text-slate-500">Completed</p>
            </div>
          </div>

          <div className="bg-white p-3 sm:p-5 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 sm:gap-4">
            <div className="size-10 sm:size-12 rounded-full bg-[#118362]/10 text-[#118362] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px] sm:text-[24px]">schedule</span>
            </div>
            <div>
              <p className="text-xl sm:text-2xl font-bold text-slate-900">{stats.hoursRead} Hours</p>
              <p className="text-xs sm:text-sm text-slate-500">Read Time</p>
            </div>
          </div>
        </section>
      )}

      {/* Continue Reading Section */}
      {filteredRecentBooks.length > 0 && (
        <section className="flex flex-col gap-3 sm:gap-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Continue Reading</h3>
          </div>
          <HorizontalScroll className="flex gap-4 sm:gap-6 pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
            {filteredRecentBooks.map((book) => (
              <div
                key={book.id}
                onClick={() => onOpenBook(book)}
                className="min-w-[220px] sm:min-w-[260px] md:min-w-[300px] snap-center sm:snap-start bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-slate-100 flex gap-3 sm:gap-4 transition hover:shadow-md cursor-pointer shrink-0"
              >
                <div
                  className="w-20 sm:w-24 h-28 sm:h-36 shrink-0 rounded-lg bg-cover bg-center shadow-sm bg-slate-200"
                  style={book.coverUrl ? { backgroundImage: `url('${book.coverUrl}')` } : undefined}
                >
                  {!book.coverUrl && (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-3xl sm:text-4xl text-slate-400">menu_book</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col flex-1 justify-between py-1">
                  <div>
                    <h4 className="font-bold text-base sm:text-lg text-slate-900 leading-tight mb-1 line-clamp-2">
                      {book.title}
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-500 line-clamp-1">{book.author}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-end text-xs font-medium">
                      <span className="text-slate-500">{book.lastChapter}</span>
                      <span className="text-primary">{book.progress}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 sm:h-2 overflow-hidden">
                      <div
                        className="bg-secondary h-full rounded-full transition-all"
                        style={{ width: `${book.progress}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </HorizontalScroll>
        </section>
      )}

      {/* Featured Suggestion Hero (Minimal & Airy) */}
      {!isSearching && featuredSuggestion && (
        <section className="relative overflow-hidden rounded-[14px] bg-indigo-50/40 border border-indigo-100 shadow-sm transition-all hover:shadow-md hover:bg-indigo-50/70">
          <div className="relative p-4 sm:p-5 md:p-6 flex flex-col sm:flex-row gap-4 md:gap-6 items-center sm:items-stretch">
            <div 
              className="w-24 sm:w-28 md:w-32 aspect-[2/3] shrink-0 rounded-lg shadow-xl shadow-slate-200/60 bg-white bg-cover bg-center border border-slate-100 transition-transform hover:scale-[1.02]"
              style={featuredSuggestion.coverUrl ? { backgroundImage: `url('${featuredSuggestion.coverUrl}')` } : undefined}
            >
              {!featuredSuggestion.coverUrl && (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-slate-300">import_contacts</span>
                </div>
              )}
            </div>
            <div className="flex flex-col flex-1 justify-center text-center sm:text-left h-full py-1">
              <span className="text-primary-600 font-bold tracking-widest text-[9px] sm:text-[10px] uppercase mb-1.5 flex items-center justify-center sm:justify-start gap-1">
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                Daily Discovery
              </span>
              <h3 className="text-xl sm:text-2xl md:text-3xl font-bold leading-tight text-slate-900 mb-1.5 line-clamp-2">
                {featuredSuggestion.title}
              </h3>
              <p className="text-slate-500 mb-4 md:mb-5 line-clamp-2 sm:line-clamp-3 max-w-xl text-xs sm:text-sm leading-relaxed">
                {((featuredSuggestion as Book & { description?: string }).description) || `Dive into this excellent book by ${featuredSuggestion.author}. Enhance your knowledge and explore new ideas curated specifically for your class.`}
              </p>
              <div className="mt-auto">
                <button
                  onClick={() => onOpenBook(featuredSuggestion)}
                  className="bg-primary hover:bg-primary-600 text-white px-5 sm:px-6 py-2 sm:py-2.5 rounded-full text-sm font-semibold transition-all shadow-md shadow-primary/20 flex items-center gap-1.5 mx-auto sm:mx-0 w-max hover:-translate-y-0.5"
                >
                  <span className="material-symbols-outlined text-[18px]">menu_book</span>
                  Start Reading
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Browsing Sections */}
      <section className="flex flex-col gap-8 sm:gap-10 mt-2">
        {/* Search Results Display */}
        {isSearching && (
          <div className="flex flex-col gap-3">
            <div className="flex justify-between items-center">
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">
                Search Results
              </h3>
            </div>
            {filteredBooks.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
                {filteredBooks.map((book) => <BookCard key={book.id} book={book} onClick={() => onOpenBook(book)} />)}
              </div>
            ) : (
              <EmptyState message={`No books matching "${searchQuery}"`} subMessage="Try a different search term" icon="search_off" />
            )}
          </div>
        )}

        {/* Normal Discover Display */}
        {!isSearching && (
          <>
            {/* Top Picks For You */}
            {topPicks.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Top Picks For Your Class</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
                  {topPicks.map((book) => <BookCard key={book.id} book={book} onClick={() => onOpenBook(book)} />)}
                </div>
              </div>
            )}

            {/* Student Favorites */}
            {studentFavorites.length > 0 && (
              <div className="flex flex-col gap-3 pt-6 border-t border-slate-100">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    <span className="material-symbols-outlined text-rose-500 text-[20px]">favorite</span>
                    Student Favorites
                  </h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
                  {studentFavorites.map((book) => <BookCard key={book.id} book={book} onClick={() => onOpenBook(book)} />)}
                </div>
              </div>
            )}

            {filteredBooks.length === 0 && (
              <EmptyState message="No books available" subMessage="Books will appear here once added by your teacher" icon="library_books" />
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function BookCard({ book, onClick }: { book: Book, onClick: () => void }) {
  return (
    <div onClick={onClick} className="group cursor-pointer">
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[10px] bg-slate-50 mb-2 sm:mb-3 border border-slate-100 shadow-sm group-hover:shadow-md transition-all duration-300">
        <div
          className="w-full h-full bg-cover bg-center transition-transform duration-700 ease-out group-hover:scale-105"
          style={book.coverUrl ? { backgroundImage: `url('${book.coverUrl}')` } : undefined}
        >
          {!book.coverUrl && (
            <div className="w-full h-full flex items-center justify-center">
              <span className="material-symbols-outlined text-4xl sm:text-5xl text-slate-300">auto_stories</span>
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-black/0 group-hover:bg-slate-900/5 transition-colors duration-300"></div>
      </div>
      <h5 className="font-bold text-sm sm:text-[15px] text-slate-800 leading-tight mb-1 line-clamp-2">{book.title}</h5>
      <p className="text-[11px] sm:text-xs text-slate-500 truncate font-medium">{book.author}</p>
    </div>
  );
}

function EmptyState({ message, subMessage, icon }: { message: string; subMessage: string; icon: string }) {
  return (
    <div className="text-center py-16 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50">
      <span className="material-symbols-outlined text-4xl sm:text-5xl text-slate-300 mb-3 block">
        {icon}
      </span>
      <h3 className="text-base sm:text-lg font-semibold text-slate-600 mb-1">
        {message}
      </h3>
      <p className="text-xs sm:text-sm text-slate-400">
        {subMessage}
      </p>
    </div>
  );
}
