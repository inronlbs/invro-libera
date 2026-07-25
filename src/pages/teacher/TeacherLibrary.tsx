import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { syncCatalogForUser } from '../../services/catalogSync';
import { useTeacherOutletContext } from '../../components/host/TeacherAppShell';

interface BookEntry {
  id: string;
  title: string;
  author: string | null;
  assigned_class: string | null;
  category: string | null;
  cover_image_base64: string | null;
  type: string;
  original_filename: string;
  file_size: number;
  hidden: boolean;
}

const coverCache = new Map<string, string>();

const BookCover = ({ book, className = '' }: { book: BookEntry, className?: string }) => {
  const [cover, setCover] = useState<string | null>(() => coverCache.get(book.id) || null);

  useEffect(() => {
    if (coverCache.has(book.id)) return;
    let mounted = true;
    invoke<string | null>('get_book_cover', { bookId: book.id })
      .then(res => {
        if (res) {
          coverCache.set(book.id, res);
          if (mounted) setCover(res);
        }
      })
      .catch(console.error);
    return () => { mounted = false; };
  }, [book.id]);

  if (cover) {
    return <img src={cover} alt={book.title} className={`object-cover ${className}`} />;
  }

  return (
    <div className={`bg-slate-200 flex items-center justify-center text-slate-400 ${className}`}>
      <span className="material-symbols-outlined text-[32px]">menu_book</span>
    </div>
  );
};

export default function TeacherLibrary() {
  const navigate = useNavigate();
  const { searchQuery } = useTeacherOutletContext();
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const loadBooks = async () => {
    try {
      setLoading(true);
      const loadedBooks = await invoke<BookEntry[]>('get_book_catalog');
      setBooks(loadedBooks);
    } catch (e) {
      console.error("Failed to load catalog", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBooks();
  }, []);

  // Filter books by search query
  const filteredBooks = useMemo(() => {
    if (!searchQuery.trim()) return books;
    const q = searchQuery.toLowerCase();
    return books.filter(b =>
      b.title.toLowerCase().includes(q) ||
      (b.author && b.author.toLowerCase().includes(q)) ||
      (b.category && b.category.toLowerCase().includes(q))
    );
  }, [books, searchQuery]);

  const handleReadBook = async (bookId: string) => {
    try {
      setLoading(true);
      await syncCatalogForUser();
      navigate(`/teacher/reader/${bookId}`);
    } catch (error) {
      console.error("Failed to sync catalog before reading:", error);
      alert("Could not load book index.");
      setLoading(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading catalog...</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Library Manager</h1>
          <p className="text-slate-500 text-sm mt-1">
            {searchQuery
              ? <>Showing <span className="font-medium text-slate-700">{filteredBooks.length}</span> of {books.length} books matching "{searchQuery}"</>
              : <>Manage encrypted books hosted on this server. <span className="font-medium">{books.length} books</span></>
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={loadBooks}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
            title="Refresh Library"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Refresh
          </button>
          
          <div className="flex bg-slate-200 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`w-10 h-8 rounded-md flex items-center justify-center transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
              title="Grid View"
            >
              <span className="material-symbols-outlined text-[18px]">grid_view</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`w-10 h-8 rounded-md flex items-center justify-center transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'}`}
              title="List View"
            >
              <span className="material-symbols-outlined text-[18px]">view_list</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {filteredBooks.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <span className="material-symbols-outlined text-[48px] text-slate-300 mb-4 block">
              {searchQuery ? 'search_off' : 'library_books'}
            </span>
            <p>{searchQuery ? `No books matching "${searchQuery}"` : 'No books are currently in the secure local library.'}</p>
          </div>
        ) : viewMode === 'list' ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Book Details</th>
                <th className="py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                <th className="py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned Class</th>
                <th className="py-4 px-6 text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBooks.map(book => (
                <tr key={book.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-4 px-6 flex items-center gap-4">
                    <div className="w-16 h-24 flex-shrink-0">
                      <BookCover book={book} className="w-full h-full rounded shadow-md border border-slate-100" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 text-base truncate max-w-[200px] md:max-w-md">{book.title}</div>
                      <div className="text-sm text-slate-500 mt-1">{book.author || 'Unknown Author'}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 uppercase tracking-wide font-medium">{book.original_filename}</div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                       {book.category || 'General'}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className="text-sm font-medium text-slate-700">
                       {book.assigned_class || 'All Classes'}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <button
                      onClick={() => handleReadBook(book.id)}
                      className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg shadow-sm hover:shadow-md transition-all flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined text-[18px]">menu_book</span>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6 grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-8">
            {filteredBooks.map(book => (
              <div 
                key={book.id} 
                className="flex flex-col gap-3 group cursor-pointer"
                onClick={() => handleReadBook(book.id)}
              >
                {/* Cover with simple fade overlay */}
                <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden shadow-sm bg-slate-50 border border-slate-200 group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-300">
                  <BookCover book={book} className="w-full h-full" />
                  
                  {/* Hover Read Indicator */}
                  <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                     <div className="w-12 h-12 bg-white text-primary rounded-full flex items-center justify-center shadow-lg transform scale-90 group-hover:scale-100 transition-all">
                        <span className="material-symbols-outlined text-[28px] ml-0.5">play_arrow</span>
                     </div>
                  </div>
                </div>

                {/* Metadata */}
                <div className="text-center px-1">
                   <div className="font-bold text-slate-800 text-sm line-clamp-2 leading-tight h-9 mb-1" title={book.title}>{book.title}</div>
                   <div className="text-[11px] text-slate-500 line-clamp-1 italic mb-1" title={book.author || 'Unknown Author'}>{book.author || 'Unknown Author'}</div>
                   <div className="flex flex-wrap items-center justify-center gap-1">
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded uppercase">
                         {book.assigned_class || 'General'}
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded uppercase">
                         {book.category || 'Books'}
                      </span>
                   </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

