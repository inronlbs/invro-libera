/**
 * Invro Libera - PDF Reader Component
 * Book-like layout with persistent sidebar and proper controls
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ttsEngine } from '../../services/ttsEngine';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauriEnvironment } from '../../services/localAuth';
import {
  updateProgress,
  getProgress,
  isTTSEnabled,
  getSettings,
  type Book
} from '../../db';
import { startTelemetryPing, stopTelemetryPing } from '../../services/telemetryService';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure PDF.js worker — use local copy instead of CDN for offline support
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// ============================================================================
// TYPES
// ============================================================================

interface PDFReaderProps {
  book: Book;
  fileUrl: string | ArrayBuffer;
  onClose: () => void;
}

type ReaderTheme = 'light' | 'sepia' | 'dark';
type PDFViewMode = 'single' | 'scroll' | 'spread';
type ZoomMode = 'custom' | 'fit-width' | 'fit-page';


const readerThemes: Record<ReaderTheme, { bg: string; text: string; pageBg: string }> = {
  light: { bg: '#f1f5f9', text: '#1f2937', pageBg: '#ffffff' },
  sepia: { bg: '#d4c4a8', text: '#3f2a14', pageBg: '#f7f1e1' },
  dark: { bg: '#171717', text: '#f5f5f5', pageBg: '#262626' }
};

interface ToolbarButtonProps {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

function ToolbarButton({ onClick, title, active, disabled, children, className = '' }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150
        ${disabled
          ? 'text-gray-300 cursor-not-allowed'
          : active
            ? 'bg-primary/10 text-primary'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
        } ${className}`}
    >
      {children}
    </button>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function PDFReader({ book, fileUrl, onClose }: PDFReaderProps) {
  // Document State
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'outline' | 'bookmarks' | 'settings'>('outline');
  const [isTtsPanelOpen, setIsTtsPanelOpen] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speechRate, setSpeechRate] = useState(1);
  const [ttsMessage, setTtsMessage] = useState<string | null>(null);
  const [pdfViewMode, setPdfViewMode] = useState<PDFViewMode>('single');
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-page');
  const [pageBaseSize, setPageBaseSize] = useState<{ width: number; height: number } | null>(null);
  const [expandedRange, setExpandedRange] = useState<number | null>(null);
  const [sidebarJumpPage, setSidebarJumpPage] = useState('');

  // Display Settings
  const [scale, setScale] = useState<number>(1.2);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light');

  // TTS State
  const [ttsState, setTtsState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const ttsEnabledForBook = isTTSEnabled(book);

  // Refs
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const navigationLockRef = useRef(false);
  const autoPlayRef = useRef(false);
  const ttsMessageTimerRef = useRef<number | null>(null);

  // Window management state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const appWindow = isTauriEnvironment() ? getCurrentWindow() : null;


  const showTtsFeedback = useCallback((message: string) => {
    setTtsMessage(message);
    if (ttsMessageTimerRef.current) {
      window.clearTimeout(ttsMessageTimerRef.current);
    }
    ttsMessageTimerRef.current = window.setTimeout(() => {
      setTtsMessage(null);
      ttsMessageTimerRef.current = null;
    }, 2800);
  }, []);

  // Telemetry tracking during PDF reading
  useEffect(() => {
    if (book && currentPage > 0) {
      startTelemetryPing(
        book.id,
        book.title,
        () => currentPage,
        () => numPages
      );
    }
    return () => stopTelemetryPing();
  }, [book, currentPage, numPages]);

  // ==========================================================================
  // PDF DOCUMENT HANDLERS
  // ==========================================================================

  const onDocumentLoadSuccess = async (doc: pdfjs.PDFDocumentProxy) => {
    setNumPages(doc.numPages);
    setIsLoading(false);
    setLoadError(null);
    try {
      const firstPage = await doc.getPage(1);
      const baseViewport = firstPage.getViewport({ scale: 1 });
      setPageBaseSize({ width: baseViewport.width, height: baseViewport.height });
    } catch (err) {
      console.warn('[PDFReader] Failed to read base page size:', err);
    }
  };

  const onDocumentLoadError = (error: Error) => {
    console.error('[PDFReader] Load error:', error);
    setIsLoading(false);
    setLoadError(`Failed to load PDF: ${error.message}`);
  };

  // ==========================================================================
  // NAVIGATION
  // ==========================================================================

  const goToPage = useCallback((page: number) => {
    if (navigationLockRef.current) return;
    navigationLockRef.current = true;

    const newPage = Math.max(1, Math.min(page, numPages));
    if (ttsEnabledForBook && ttsState === 'playing' && newPage !== currentPage) {
      autoPlayRef.current = true;
    }
    setCurrentPage(newPage);

    if (pdfViewMode === 'scroll') {
      requestAnimationFrame(() => {
        pageRefs.current[newPage]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    updateProgress(book.id, newPage, undefined, numPages).catch(err =>
      console.error('[PDFReader] Failed to save progress:', err)
    );

    setTimeout(() => { navigationLockRef.current = false; }, 200);
  }, [numPages, book.id, ttsEnabledForBook, ttsState, currentPage, pdfViewMode]);

  const goToPrev = useCallback(() => {
    const step = pdfViewMode === 'spread' ? 2 : 1;
    if (currentPage > 1) goToPage(currentPage - step);
  }, [currentPage, goToPage, pdfViewMode]);

  const goToNext = useCallback(() => {
    const step = pdfViewMode === 'spread' ? 2 : 1;
    if (currentPage < numPages) goToPage(currentPage + step);
  }, [currentPage, numPages, goToPage, pdfViewMode]);

  // ==========================================================================
  // TTS HANDLERS
  // ==========================================================================

  const handlePageAudioComplete = useCallback(() => {
    if (currentPage < numPages) {
      autoPlayRef.current = true;
      goToNext();
    } else {
      setTtsState('stopped');
      ttsEngine.stop();
    }
  }, [currentPage, goToNext, numPages]);

  const extractPageText = useCallback(async (pageNumber: number): Promise<string> => {
    if (!pdfDocRef.current) return '';
    try {
      const page = await pdfDocRef.current.getPage(pageNumber);
      const textContent = await page.getTextContent();
      return textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    } catch (err) {
      console.error('[PDFReader] Failed to extract text:', err);
      return '';
    }
  }, []);

  const playPageAudio = useCallback(async (pageNumber: number) => {
    if (!ttsEnabledForBook) return;
    if (!pdfDocRef.current) {
      console.warn('[PDFReader] PDF not ready for TTS playback');
      return;
    }

    try {
      const pageText = await extractPageText(pageNumber);
      const normalized = pageText.trim();
      if (!normalized) {
        console.warn('[PDFReader] No readable text found for TTS');
        showTtsFeedback('No readable text on this page.');
        await ttsEngine.stop();
        setTtsState('stopped');
        return;
      }
      await ttsEngine.speak(normalized, pageNumber);
      setTtsState('playing');
    } catch (err) {
      console.error('[PDFReader] Failed to start TTS:', err);
      showTtsFeedback('Unable to start narration. Please try again.');
      await ttsEngine.stop();
      setTtsState('stopped');
    }
  }, [extractPageText, ttsEnabledForBook, showTtsFeedback]);

  const handleTtsToggle = useCallback(async () => {
    if (ttsState === 'stopped') {
      await playPageAudio(currentPage);
    } else if (ttsState === 'playing') {
      ttsEngine.pause();
      setTtsState('paused');
    } else if (ttsState === 'paused') {
      ttsEngine.resume();
      setTtsState('playing');
    }
  }, [currentPage, playPageAudio, ttsState]);

  const handleTtsStop = useCallback(() => {
    autoPlayRef.current = false;
    ttsEngine.stop();
    setTtsState('stopped');
  }, []);

  const handleVoiceChange = useCallback((voiceName: string) => {
    setSelectedVoice(voiceName);
    ttsEngine.setVoice(voiceName).catch((err) => console.error('[PDFReader] Failed to update TTS voice:', err));
  }, []);

  const handleRateChange = useCallback((value: number) => {
    setSpeechRate(value);
    ttsEngine.setRate(value).catch((err) => console.error('[PDFReader] Failed to update TTS rate:', err));
  }, []);

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  useEffect(() => {
    const loadProgress = async () => {
      const progress = await getProgress(book.id);
      if (progress && progress.lastPage) {
        setCurrentPage(progress.lastPage);
      }
    };
    loadProgress();

    if (ttsEnabledForBook) {
      ttsEngine.initialize(book.title, book.coverUrl, 0, {
        onPageComplete: handlePageAudioComplete,
        onPlayStateChange: (playing) => setTtsState(playing ? 'playing' : 'stopped'),
        onError: (err) => console.error('[PDFReader] TTS Error:', err)
      });
    }

    const handleVisibility = () => ttsEngine.handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      ttsEngine.destroy();
    };
  }, [book.id, book.title, book.coverUrl, ttsEnabledForBook, handlePageAudioComplete]);


  useEffect(() => {
    if (!ttsEnabledForBook) return;
    let cancelled = false;
    const hydrateSettings = async () => {
      try {
        const settings = await getSettings();
        if (!cancelled) {
          setSpeechRate(settings.ttsRate ?? 1);
          setSelectedVoice(settings.ttsVoice ?? '');
        }
      } catch (err) {
        console.error('[PDFReader] Failed to load TTS settings:', err);
      }
    };

    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    const loadVoices = () => {
      if (!synth || cancelled) return;
      const voices = synth.getVoices();
      setAvailableVoices(voices);
    };

    hydrateSettings();
    loadVoices();
    synth?.addEventListener('voiceschanged', loadVoices);

    return () => {
      cancelled = true;
      synth?.removeEventListener('voiceschanged', loadVoices);
    };
  }, [ttsEnabledForBook]);

  useEffect(() => {
    return () => {
      if (ttsMessageTimerRef.current) {
        window.clearTimeout(ttsMessageTimerRef.current);
      }
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeSidebarTab === 'settings') return;

      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goToPrev(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goToNext(); }
      if (e.key === ' ' && ttsEnabledForBook) { e.preventDefault(); void handleTtsToggle(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSidebarTab, goToPrev, goToNext, ttsEnabledForBook, handleTtsToggle]);

  useEffect(() => {
    if (!ttsEnabledForBook) return;
    if (!autoPlayRef.current) return;
    autoPlayRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      void playPageAudio(currentPage);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPage, playPageAudio, ttsEnabledForBook]);

  useEffect(() => {
    if (pdfViewMode !== 'scroll') return;
    const node = containerRef.current;
    if (!node) return;

    const onScroll = () => {
      const scrollTop = node.scrollTop;
      let nearestPage = currentPage;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (let page = 1; page <= numPages; page += 1) {
        const el = pageRefs.current[page];
        if (!el) continue;
        const distance = Math.abs(el.offsetTop - scrollTop - 12);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestPage = page;
        }
      }

      if (nearestPage !== currentPage) {
        setCurrentPage(nearestPage);
      }
    };

    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [pdfViewMode, currentPage, numPages]);

  // Track maximize/fullscreen state
  useEffect(() => {
    if (appWindow) {
      // Tauri environment
      const checkMaxState = async () => {
        try {
          setIsFullscreen(await appWindow.isFullscreen());
        } catch {
          // ignore
        }
      };
      checkMaxState();
      const unlisten = appWindow.onResized(() => { checkMaxState(); });
      return () => { unlisten.then(fn => fn()); };
    } else {
      // Browser environment — track fullscreen via DOM events
      const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange', onFsChange);
      return () => document.removeEventListener('fullscreenchange', onFsChange);
    }
  }, [appWindow]);

  const handleDoubleClickTitleBar = async () => {
    if (!appWindow) return;
    await appWindow.toggleMaximize();
  };

  const handleDragPdf = async (e: React.MouseEvent) => {
    if (!appWindow) return;
    if (e.buttons === 1) {
      await appWindow.startDragging();
    }
  };

  const toggleFullscreen = async () => {
    try {
      const isCurrentlyFs = isFullscreen || !!document.fullscreenElement || (appWindow ? await appWindow.isFullscreen() : false);

      if (!isCurrentlyFs) {
        // Enter Fullscreen: collapse left sidebar to maximize book reading space
        setShowSidebar(false);
        if (containerRef.current?.requestFullscreen) {
          await containerRef.current.requestFullscreen().catch(() => {});
        } else if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen().catch(() => {});
        }
        if (appWindow) {
          await appWindow.setFullscreen(true).catch(() => {});
        }
        setIsFullscreen(true);
      } else {
        // Exit Fullscreen: restore sidebar
        setShowSidebar(true);
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen().catch(() => {});
        }
        if (appWindow) {
          await appWindow.setFullscreen(false).catch(() => {});
        }
        setIsFullscreen(false);
      }
    } catch (err) {
      console.warn('[PDFReader] Fullscreen toggle fallback:', err);
      setShowSidebar(!showSidebar);
      setIsFullscreen(!isFullscreen);
    }
  };

  // ==========================================================================
  // ZOOM & LAYOUT CONTROLS
  // ==========================================================================

  const applyZoomMode = useCallback((mode: ZoomMode) => {
    setZoomMode(mode);

    if (mode === 'custom') {
      return;
    }

    if (!pageBaseSize || !containerRef.current) return;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const horizontalPadding = pdfViewMode === 'spread' ? 96 : 56;
    const verticalPadding = 56;
    const effectiveWidth = Math.max(320, containerWidth - horizontalPadding);
    const effectiveHeight = Math.max(320, containerHeight - verticalPadding);

    const pagesPerRow = pdfViewMode === 'spread' ? 2 : 1;
    const widthScale = (effectiveWidth / pagesPerRow) / pageBaseSize.width;
    const heightScale = effectiveHeight / pageBaseSize.height;

    const nextScale = mode === 'fit-page' ? Math.min(widthScale, heightScale) : widthScale;
    setScale(Math.max(0.5, Math.min(nextScale, 3)));
  }, [pageBaseSize, pdfViewMode]);

  const zoomIn = () => {
    setZoomMode('custom');
    setScale((s) => Math.min(s + 0.15, 3));
  };

  const zoomOut = () => {
    setZoomMode('custom');
    setScale((s) => Math.max(s - 0.15, 0.5));
  };

  const changeViewMode = (mode: PDFViewMode) => {
    setPdfViewMode(mode);
    if (mode === 'spread' && currentPage % 2 === 0) {
      setCurrentPage((prev) => Math.max(1, prev - 1));
    }
  };

  useEffect(() => {
    if (zoomMode === 'custom') return;
    const frame = window.requestAnimationFrame(() => {
      applyZoomMode(zoomMode);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [zoomMode, applyZoomMode, currentPage, numPages]);


  const theme = readerThemes[readerTheme];

  return (
    <div ref={containerRef} className={`absolute inset-0 z-10 flex select-none reader-theme reader-theme-${readerTheme}`} style={{ height: '100%' }}>

      {/* Mobile Sidebar Backdrop removed */}

      {/* ════════════════════════ SIDEBAR ════════════════════════ */}
      <aside
        className={`flex-shrink-0 flex flex-col bg-white border-r border-gray-200/70 z-30 md:z-20
          transition-[width] duration-300 ease-[cubic-bezier(.16,1,.3,1)] overflow-hidden
          absolute inset-y-0 left-0 h-full md:relative md:inset-auto
          ${showSidebar ? 'w-[85vw] max-w-[300px] md:w-72 shadow-2xl md:shadow-none' : 'w-0'}`}
      >
        {/* Sidebar — Book Info */}
        <div className="px-4 pt-4 pb-3 flex-shrink-0">
          <div className="flex items-start gap-3">
            <button
              onClick={onClose}
              className="mt-0.5 p-1.5 -ml-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Back to Library"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back_ios_new</span>
            </button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[13px] font-semibold text-gray-900 leading-tight line-clamp-2">{book.title}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">{book.author}</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 border-t border-gray-100" />

        {/* Sidebar — Tabs */}
        <div className="flex items-center px-2 mt-2 border-b border-gray-100 flex-shrink-0">
          {(['outline', 'bookmarks', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSidebarTab(tab)}
              className={`flex-1 pb-2.5 text-[12px] font-semibold transition-colors relative flex items-center justify-center gap-1.5
                ${activeSidebarTab === tab ? 'text-primary' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <span className="material-symbols-outlined text-[16px]">
                {tab === 'outline' ? 'format_list_bulleted' : tab === 'bookmarks' ? 'bookmark' : 'tune'}
              </span>
              
              {activeSidebarTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* Sidebar — Tab Content */}
        <div className="flex-1 overflow-hidden relative bg-gray-50/30">
          
          {/* Pages Tab */}
          {activeSidebarTab === 'outline' && (
            <div className="absolute inset-0 overflow-y-auto scrollbar-thin p-2">
              <div className="space-y-2">
                {/* Jump to page */}
                <div className="px-1 pt-1">
                  <div className="flex items-center h-8 bg-gray-100 rounded-lg px-2.5 gap-2">
                    <span className="material-symbols-outlined text-[15px] text-gray-400">pin</span>
                    <input
                      type="number"
                      min={1}
                      max={numPages}
                      value={sidebarJumpPage}
                      onChange={(e) => setSidebarJumpPage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const p = parseInt(sidebarJumpPage);
                          if (p >= 1 && p <= numPages) { goToPage(p); setSidebarJumpPage(''); }
                        }
                      }}
                      placeholder={`Go to page (1–${numPages})`}
                      className="flex-1 bg-transparent text-[12px] text-gray-700 placeholder:text-gray-400 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {sidebarJumpPage && (
                      <button
                        onClick={() => {
                          const p = parseInt(sidebarJumpPage);
                          if (p >= 1 && p <= numPages) { goToPage(p); setSidebarJumpPage(''); }
                        }}
                        className="text-primary text-[11px] font-semibold hover:underline"
                      >
                        Go
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress indicator */}
                <div className="px-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Progress</span>
                    <span className="text-[11px] font-semibold text-primary tabular-nums">{Math.round((currentPage / numPages) * 100)}%</span>
                  </div>
                  <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-300"
                      style={{ width: `${(currentPage / numPages) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Collapsible page ranges */}
                <div className="px-1">
                  <div className="px-1 pt-1 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Pages</div>
                  {(() => {
                    const CHUNK = 25;
                    const rangeCount = Math.ceil(numPages / CHUNK);
                    return Array.from({ length: rangeCount }, (_, ri) => {
                      const start = ri * CHUNK + 1;
                      const end = Math.min((ri + 1) * CHUNK, numPages);
                      const isExpanded = expandedRange === ri;
                      const containsCurrent = currentPage >= start && currentPage <= end;

                      return (
                        <div key={ri}>
                          <button
                            onClick={() => setExpandedRange(isExpanded ? null : ri)}
                            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[12px] transition-colors duration-150
                              ${containsCurrent && !isExpanded
                                ? 'text-primary font-semibold bg-primary/5'
                                : 'text-gray-600 hover:bg-gray-100'
                              }`}
                          >
                            <span className="font-medium">Pages {start}–{end}</span>
                            <span className="material-symbols-outlined text-[14px] text-gray-400 transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : undefined }}>
                              expand_more
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="grid grid-cols-5 gap-1 px-1 py-1.5 animate-fade-in">
                              {Array.from({ length: end - start + 1 }, (_, j) => start + j).map((page) => (
                                <button
                                  key={page}
                                  onClick={() => goToPage(page)}
                                  className={`h-7 text-[11px] rounded-md font-medium transition-all duration-150
                                    ${page === currentPage
                                      ? 'bg-primary text-white shadow-sm'
                                      : 'text-gray-500 hover:bg-gray-100'
                                    }`}
                                >
                                  {page}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Bookmarks Tab */}
          {activeSidebarTab === 'bookmarks' && (
            <div className="absolute inset-0 overflow-y-auto p-4 flex flex-col items-center justify-center text-center text-gray-400">
               <span className="material-symbols-outlined text-[32px] mb-2 opacity-50">bookmark_border</span>
               <p className="text-[13px] font-medium">Bookmarks</p>
               <p className="text-[11px] mt-1 opacity-70 max-w-[200px]">Save your spot using the bookmark icon in the top toolbar.</p>
            </div>
          )}

          {/* Settings Tab */}
          {activeSidebarTab === 'settings' && (
            <div className="absolute inset-0 overflow-y-auto p-3 space-y-5">
              {/* Theme */}
              <div>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">Theme</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setReaderTheme(t)}
                      className={`p-2 rounded-lg border-2 transition-all duration-200
                        ${readerTheme === t
                          ? 'border-primary shadow-sm'
                          : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <div
                        className="w-full h-6 rounded mb-1.5"
                        style={{ background: readerThemes[t].pageBg, border: '1px solid rgba(0,0,0,0.06)' }}
                      />
                      <span className="text-[10px] font-medium capitalize text-gray-600">{t}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Zoom */}
              <div>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">Zoom</span>
                <div className="flex items-center gap-1.5 mb-2">
                  <button onClick={() => applyZoomMode('fit-page')} className={`flex-1 h-8 rounded-lg border-2 text-[11px] font-medium transition-all ${zoomMode === 'fit-page' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    Fit Page
                  </button>
                  <button onClick={() => applyZoomMode('custom')} className={`flex-1 h-8 rounded-lg border-2 text-[11px] font-medium transition-all ${zoomMode === 'custom' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                    Custom
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={zoomOut} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
                    <span className="material-symbols-outlined text-[16px]">zoom_out</span>
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-sm font-bold text-gray-800 tabular-nums">{Math.round(scale * 100)}%</span>
                  </div>
                  <button onClick={zoomIn} className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
                    <span className="material-symbols-outlined text-[16px]">zoom_in</span>
                  </button>
                </div>
              </div>

              {/* View Mode */}
              <div>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">Layout</span>
                <div className="flex items-center bg-gray-100 rounded-full p-0.5 gap-0.5">
                  {([
                    ['single', 'crop_portrait', 'Single Page'] as [PDFViewMode, string, string],
                    ['spread', 'auto_stories', 'Two Pages'] as [PDFViewMode, string, string],
                    ['scroll', 'view_agenda', 'Scroll'] as [PDFViewMode, string, string],
                  ]).map(([mode, icon, label]) => (
                    <button
                      key={mode}
                      onClick={() => changeViewMode(mode)}
                      title={label}
                      className={`flex-1 h-8 rounded-full flex items-center justify-center transition-all duration-200
                        ${pdfViewMode === mode
                          ? 'bg-white text-primary shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                        }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{icon}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Sidebar — Footer */}
        <div className="px-3 py-2 border-t border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-400 font-medium">{numPages} pages</span>
            <button
              onClick={() => setShowSidebar(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Close sidebar"
            >
              <span className="material-symbols-outlined text-[18px]">left_panel_close</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ════════════════════════ MAIN READER ════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0" style={{ background: theme.bg }}>

        {/* ─── Toolbar ─── */}
        <header
          onMouseDown={appWindow ? handleDragPdf : undefined}
          onDoubleClick={appWindow ? handleDoubleClickTitleBar : undefined}
          className="h-10 sm:h-11 flex-shrink-0 flex items-center px-2 gap-1 bg-white/95 backdrop-blur-md border-b border-gray-200/60 z-10 overflow-x-auto scrollbar-hide cursor-default select-none"
        >

          {/* Left: sidebar + page nav */}
          <div className="flex items-center gap-0.5 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
            {!showSidebar && (
              <ToolbarButton onClick={() => setShowSidebar(true)} title="Show sidebar">
                <span className="material-symbols-outlined text-[20px]">left_panel_open</span>
              </ToolbarButton>
            )}

            <ToolbarButton onClick={goToPrev} title="Previous page" disabled={currentPage <= 1}>
              <span className="material-symbols-outlined text-[20px]">navigate_before</span>
            </ToolbarButton>

            <div className="flex items-center h-7 bg-gray-100 rounded-lg px-1.5 gap-1">
              <input
                type="number"
                min={1}
                max={numPages}
                value={currentPage}
                onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
                className="w-10 bg-transparent text-center text-[13px] font-medium text-gray-700 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[11px] text-gray-400 font-medium whitespace-nowrap">/ {numPages}</span>
            </div>

            <ToolbarButton onClick={goToNext} title="Next page" disabled={currentPage >= numPages}>
              <span className="material-symbols-outlined text-[20px]">navigate_next</span>
            </ToolbarButton>
          </div>

          {/* Spacer */}
          <div className="flex-1 shrink-0" />

          {/* Right: Actions */}
          <div className="flex items-center gap-0.5 shrink-0" onMouseDown={(e) => e.stopPropagation()}>

            {ttsEnabledForBook && (
              <button
                onClick={() => setIsTtsPanelOpen(true)}
                className={`h-7 px-2.5 rounded-lg flex items-center gap-1.5 text-[12px] font-semibold transition-all duration-150 shrink-0
                  ${ttsState !== 'stopped'
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-primary bg-primary/10 hover:bg-primary/15'
                  }`}
                title="Text-to-Speech"
              >
                <span className="material-symbols-outlined text-[16px]">{ttsState === 'playing' ? 'graphic_eq' : 'headset'}</span>
                <span className="hidden sm:inline">{ttsState === 'playing' ? 'Playing' : ttsState === 'paused' ? 'Paused' : 'Listen'}</span>
              </button>
            )}

            <div className="w-px h-5 bg-gray-200 mx-1 shrink-0" />

            <ToolbarButton onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
              <span className="material-symbols-outlined text-[18px]">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
            </ToolbarButton>

            <ToolbarButton onClick={onClose} title="Close reader" className="hover:!bg-red-50 hover:!text-red-500">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </ToolbarButton>
          </div>
        </header>

        {/* ─── PDF Viewing Area ─── */}
        <div ref={containerRef} className="flex-1 overflow-auto relative pdf-viewer-scroll">
          {/* Loading */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: theme.bg }}>
              <div className="flex flex-col items-center gap-4">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
                  <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
                <p className="text-[13px] font-medium text-gray-400">Loading document…</p>
              </div>
            </div>
          )}

          {/* Error */}
          {loadError ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-[28px] text-red-400">error_outline</span>
              </div>
              <p className="text-base font-semibold text-gray-700">{loadError}</p>
              <p className="text-sm text-gray-400 mt-1.5">The file may be corrupted or inaccessible.</p>
              <button onClick={onClose} className="mt-5 px-5 py-2 bg-primary text-white rounded-lg text-sm font-medium shadow-sm hover:shadow transition-shadow">
                Return to Library
              </button>
            </div>
          ) : (
            <Document
              file={fileUrl}
              onLoadSuccess={(doc) => {
                pdfDocRef.current = doc;
                onDocumentLoadSuccess(doc);
              }}
              onLoadError={onDocumentLoadError}
              loading={null}
            >
              {/* Scroll mode */}
              {pdfViewMode === 'scroll' && (
                <div className="flex flex-col items-center gap-6 p-6 md:p-8">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
                    <div
                      key={page}
                      ref={(el) => { pageRefs.current[page] = el; }}
                      className="rounded-sm overflow-hidden transition-shadow duration-200"
                      style={{
                        background: theme.pageBg,
                        boxShadow: currentPage === page
                          ? '0 0 0 2px var(--color-primary), 0 4px 24px rgba(0,0,0,0.10)'
                          : '0 1px 8px rgba(0,0,0,0.06), 0 4px 24px rgba(0,0,0,0.04)',
                      }}
                    >
                      <Page pageNumber={page} scale={scale} renderTextLayer renderAnnotationLayer loading={null} />
                    </div>
                  ))}
                </div>
              )}

              {/* Single page */}
              {pdfViewMode === 'single' && (
                <div className="min-h-full flex items-start justify-center p-4 md:p-10">
                  <div
                    key={currentPage}
                    className="rounded-sm overflow-hidden pdf-page-enter"
                    style={{
                      background: theme.pageBg,
                      boxShadow: '0 1px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.08)',
                    }}
                  >
                    <Page pageNumber={currentPage} scale={scale} renderTextLayer renderAnnotationLayer loading={null} />
                  </div>
                </div>
              )}

              {/* Spread (two-page) */}
              {pdfViewMode === 'spread' && (
                <div className="min-h-full flex items-start justify-center p-4 md:p-10">
                  <div key={currentPage} className="flex items-start gap-1 pdf-page-enter">
                    <div
                      className="rounded-sm overflow-hidden"
                      style={{
                        background: theme.pageBg,
                        boxShadow: '0 1px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.08)',
                      }}
                    >
                      <Page pageNumber={currentPage} scale={scale} renderTextLayer renderAnnotationLayer loading={null} />
                    </div>
                    {currentPage + 1 <= numPages && (
                      <div
                        className="rounded-sm overflow-hidden"
                        style={{
                          background: theme.pageBg,
                          boxShadow: '0 1px 8px rgba(0,0,0,0.06), 0 8px 32px rgba(0,0,0,0.08)',
                        }}
                      >
                        <Page pageNumber={currentPage + 1} scale={scale} renderTextLayer renderAnnotationLayer loading={null} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Document>
          )}

          {/* TTS Feedback Toast */}
          {ttsMessage && (
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 px-4 py-2.5 rounded-full bg-gray-900/90 backdrop-blur-sm text-white text-[13px] font-medium shadow-lg animate-fade-in">
              {ttsMessage}
            </div>
          )}
        </div>

      </div>

      {/* ════════════════════════ TTS INLINE TOOLBAR ════════════════════════ */}
      {ttsEnabledForBook && isTtsPanelOpen && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-slide-up w-[calc(100%-2rem)] max-w-md md:w-auto md:max-w-none">
          <div className="bg-white rounded-2xl md:rounded-full shadow-2xl border border-gray-200/60 px-3 py-2.5 md:px-4 md:py-2 backdrop-blur-md">

            {/* ── Desktop: single row ── */}
            <div className="flex items-center gap-3">
              <button onClick={handleTtsToggle} className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center shadow-sm hover:shadow transition-shadow" title={ttsState === 'playing' ? 'Pause' : 'Play'}>
                <span className="material-symbols-outlined text-[24px]">{ttsState === 'playing' ? 'pause' : 'play_arrow'}</span>
              </button>
              <button onClick={handleTtsStop} className="w-10 h-10 rounded-full text-gray-500 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors" title="Stop">
                <span className="material-symbols-outlined text-[24px]">stop</span>
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button onClick={goToPrev} disabled={currentPage <= 1} className="w-8 h-8 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors disabled:opacity-50" title="Previous page">
                <span className="material-symbols-outlined text-[20px]">skip_previous</span>
              </button>
              <button onClick={goToNext} disabled={currentPage >= numPages} className="w-8 h-8 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors disabled:opacity-50" title="Next page">
                <span className="material-symbols-outlined text-[20px]">skip_next</span>
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-gray-400">speed</span>
                <select value={speechRate} onChange={(e) => handleRateChange(parseFloat(e.target.value))} className="bg-transparent text-[13px] font-medium text-gray-700 focus:outline-none cursor-pointer" title="Speed">
                  <option value={0.5}>0.5x</option><option value={0.75}>0.75x</option><option value={1}>1x</option><option value={1.25}>1.25x</option><option value={1.5}>1.5x</option><option value={2}>2x</option>
                </select>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span className="material-symbols-outlined text-[18px] text-gray-400">record_voice_over</span>
                <select value={selectedVoice} onChange={(e) => handleVoiceChange(e.target.value)} className="bg-transparent text-[13px] font-medium text-gray-700 focus:outline-none cursor-pointer max-w-[120px] truncate" title="Voice">
                  <option value="">Auto</option>
                  {availableVoices.map((voice) => (<option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name}</option>))}
                </select>
              </div>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button onClick={() => setIsTtsPanelOpen(false)} className="w-8 h-8 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors" title="Hide toolbar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>



          </div>
        </div>
      )}



    </div>
  );
}
