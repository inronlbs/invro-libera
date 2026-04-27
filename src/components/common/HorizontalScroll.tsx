import { useRef, useState, useEffect } from 'react';

export default function HorizontalScroll({ 
  children, 
  className = '', 
  containerClassName = '',
  scrollAmount = 300 
}: {
  children: React.ReactNode;
  className?: string; 
  containerClassName?: string;
  scrollAmount?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  // Use a ref to check if we are scrolling to update buttons immediately
  const checkScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeft(scrollLeft > 0);
      setShowRight(Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1); // tolerance
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []); // Run once on mount

  useEffect(() => {
    // Re-check when children change (content might be dynamic)
    checkScroll();
  }, [children]);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      // Scroll by 80% of client width for better UX
      const amount = scrollAmount || clientWidth * 0.8;
      
      const newScroll = direction === 'left' 
        ? scrollLeft - amount 
        : scrollLeft + amount;
      
      scrollRef.current.scrollTo({
        left: newScroll,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className={`relative group ${containerClassName}`}>
      {showLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-white shadow-md border border-slate-100 rounded-full w-8 h-8 flex items-center justify-center hover:bg-slate-50 transition-all -ml-3 hidden sm:flex focus:outline-none focus:ring-2 focus:ring-primary/20"
          aria-label="Scroll left"
        >
          <span className="material-symbols-outlined text-[20px] text-slate-600">chevron_left</span>
        </button>
      )}

      <div 
        ref={scrollRef}
        onScroll={checkScroll}
        className={`overflow-x-auto scrollbar-hide ${className}`}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {children}
      </div>

      {showRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white shadow-md border border-slate-100 rounded-full w-8 h-8 flex items-center justify-center hover:bg-slate-50 transition-all -mr-3 hidden sm:flex focus:outline-none focus:ring-2 focus:ring-primary/20"
          aria-label="Scroll right"
        >
          <span className="material-symbols-outlined text-[20px] text-slate-600">chevron_right</span>
        </button>
      )}
    </div>
  );
}
