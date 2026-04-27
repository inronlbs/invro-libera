/**
 * Invro Libera - Header Component
 * Top navigation bar with search and user actions
 */

import { useRef, useEffect } from 'react';

// ============================================================================
// TYPES
// ============================================================================

interface HeaderProps {
  showSearch?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function HeaderNew({ 
  showSearch = true,
  searchQuery = '',
  onSearchChange,
}: HeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange?.(e.target.value);
  };

  const handleClear = () => {
    onSearchChange?.('');
    inputRef.current?.focus();
  };

  // Ctrl+K keyboard shortcut to focus search
  useEffect(() => {
    if (!showSearch) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSearch]);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between whitespace-nowrap border-b border-solid border-slate-200 dark:border-neutral-700 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md px-4 py-3 sm:px-6 lg:px-10">
      <div className="flex items-center gap-3 sm:gap-6 lg:gap-8 w-full">


        {/* Search Bar */}
        {showSearch && (
          <div className="flex flex-1 justify-center max-w-2xl mx-auto w-full">
            <label className="flex flex-col w-full max-w-md h-10 relative group">
                <div className="flex w-full flex-1 items-stretch rounded-lg h-full ring-1 ring-slate-200 dark:ring-neutral-600 bg-slate-50 dark:bg-neutral-800 transition-all group-focus-within:ring-primary group-focus-within:ring-2">
                <div className="text-slate-400 flex border-none bg-transparent items-center justify-center pl-4 rounded-l-lg">
                  <span className="material-symbols-outlined text-[20px]">search</span>
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-0 border-none bg-transparent h-full placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2 sm:px-3 text-sm font-normal leading-normal"
                  placeholder="Search books..."
                />
                {/* Clear button or Ctrl+K hint */}
                <div className="flex items-center pr-3">
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={handleClear}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5 rounded"
                      title="Clear search"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  ) : (
                    <span className="hidden sm:inline text-xs font-medium text-slate-400 bg-white dark:bg-neutral-700 px-1.5 py-0.5 rounded border border-slate-200 dark:border-neutral-600">
                      Ctrl+K
                    </span>
                  )}
                </div>
              </div>
            </label>
          </div>
        )}
      </div>
    </header>
  );
}

