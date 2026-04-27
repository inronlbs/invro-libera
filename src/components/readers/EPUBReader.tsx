/**
 * Invro Libera - EPUB Reader Component
 * Book-like layout with persistent sidebar, proper controls, and multiple layout options
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { EpubView } from 'react-reader';
import { EpubCFI, type Contents, type Rendition, type NavItem } from 'epubjs';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ttsEngine } from '../../services/ttsEngine';
import { updateProgress, getProgress, isTTSEnabled, getSettings, type Book } from '../../db';
import { isTauriEnvironment } from '../../services/localAuth';

// ============================================================================
// TYPES
// ============================================================================

interface EPUBReaderProps {
  book: Book;
  fileUrl: string | ArrayBuffer;
  onClose: () => void;
}

type ReaderTheme = 'light' | 'sepia' | 'dark';


interface ReaderLocationBoundary {
  cfi?: string;
  href?: string;
  displayed?: { page?: number; total?: number };
  location?: number;
  percentage?: number;
  index?: number;
}

interface ReaderLocationSnapshot {
  start?: ReaderLocationBoundary;
  end?: ReaderLocationBoundary;
  atEnd?: boolean;
}

interface EpubSpineItem {
  href?: string;
  index?: number;
}

interface EpubSpineContainer {
  spineItems?: EpubSpineItem[];
  items?: EpubSpineItem[];
}


const readerThemes: Record<ReaderTheme, { bg: string; text: string; pageBg: string }> = {
  light: { bg: '#f1f5f9', text: '#1f2937', pageBg: '#ffffff' },
  sepia: { bg: '#d4c4a8', text: '#3f2a14', pageBg: '#f7f1e1' },
  dark: { bg: '#171717', text: '#f5f5f5', pageBg: '#262626' }
};



// ============================================================================
// COMPONENT
// ============================================================================

/* Toolbar icon button helper */
const TBtn = ({ onClick, title, active, disabled, children, className = '' }: { 
  onClick: () => void; title: string; active?: boolean; disabled?: boolean;
  children: React.ReactNode; className?: string;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200
      ${active 
        ? 'bg-primary/10 text-primary hover:bg-primary/20' 
        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
      }
      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      ${className}
    `}
    title={title}
  >
    {children}
  </button>
);

export default function EPUBReader({ book, fileUrl, onClose }: EPUBReaderProps) {
  // Navigation & Content State
  const [currentChapter, setCurrentChapter] = useState<string>('Loading...');
  const [toc, setToc] = useState<NavItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [readerMounted, setReaderMounted] = useState(false);
  // Sidebar State
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'toc' | 'bookmarks' | 'settings'>('toc');
  const [fontSize, setFontSize] = useState(100);
  const [fontFamily, setFontFamily] = useState('Literata');
  const [lineHeight, setLineHeight] = useState(1.8);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light');
  
  const [progress, setProgress] = useState(0);
  
  // Window management state
  const appWindow = isTauriEnvironment() ? getCurrentWindow() : null;
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // TTS State
  const [ttsState, setTtsState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [isTtsPanelOpen, setIsTtsPanelOpen] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [speechRate, setSpeechRate] = useState(1);
  const [ttsMessage, setTtsMessage] = useState<string | null>(null);
  const [, setTtsSentences] = useState<Array<{ text: string; cfi: string; index: number }>>([]);
  const [, setCurrentTtsIndex] = useState<number>(-1);
  const [selectionCfi, setSelectionCfi] = useState<string | null>(null);
  const [selectionRect, setSelectionRect] = useState<{ top: number; left: number } | null>(null);
  const [, setSelectionText] = useState<string>('');
  const selectionTextRef = useRef<string>('');
  const ttsEnabledForBook = isTTSEnabled(book);
  
  // Refs
  const renditionRef = useRef<Rendition | null>(null);
  const tocRef = useRef<NavItem[]>([]);
  const navigationLockRef = useRef(false);

  // EpubJS core refs
  // (managed by EpubView now)

  const ttsMessageTimerRef = useRef<number | null>(null);
  
  // TOC Refs
  const nativeTocRef = useRef<NavItem[] | null>(null); // Raw publisher TOC
  const spineReadyRef = useRef(false); // Flag if spine is fully loaded
  const currentHighlightCfiRef = useRef<string | null>(null);
  const ttsSentencesRef = useRef<Array<{ text: string; cfi: string; index: number }>>([]);
  const lastSelectionTimeRef = useRef<number>(0);



  const [zenMode, setZenMode] = useState(false);
  
  const [readerLocation, setReaderLocation] = useState<string | number | null>(null);
  const currentCfiRef = useRef<string | null>(null);

  const getActiveContents = useCallback(() => {
    return (renditionRef.current as unknown as { getContents?: () => Contents[] | undefined })?.getContents?.() ?? [];
  }, []);

  // Loading timeout removed — EpubView handles its own internal load state errors.

  // Defer ReactReader mount so the loading overlay paints first
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      // Double-rAF ensures the browser actually paints the loading spinner
      requestAnimationFrame(() => setReaderMounted(true));
    });
    return () => cancelAnimationFrame(raf);
  }, []);

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
        console.error('[EPUBReader] Failed to load TTS settings:', err);
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

  // ==========================================================================
  // TTS HANDLERS
  // ==========================================================================

  const highlightSentence = useCallback((index: number) => {
    const rendition = renditionRef.current;
    if (!rendition) return;

    // Remove previous highlight
    if (currentHighlightCfiRef.current) {
      try {
        rendition.annotations.remove(currentHighlightCfiRef.current, 'highlight');
      } catch (e) {
        console.warn('Failed to remove highlight', e);
      }
    }

    const sentence = ttsSentencesRef.current[index];
    if (sentence) {
      try {
        rendition.annotations.highlight(
          sentence.cfi,
          {},
          (e: Event) => { console.log('Highlight clicked', e); },
          'epub-tts-highlight',
          { fill: '#fbbf24', 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' }
        );
        currentHighlightCfiRef.current = sentence.cfi;
        
        // Check if we need to turn the page to show the highlighted sentence
        try {
          const currentLocation = rendition.currentLocation() as ReaderLocationSnapshot | null;
          if (currentLocation && currentLocation.start && currentLocation.end) {
            const startCfi = currentLocation.start.cfi;
            const endCfi = currentLocation.end.cfi;
            const cfiUtil = new EpubCFI();
            const beforeStart = startCfi ? cfiUtil.compare(sentence.cfi, startCfi) < 0 : false;
            const afterEnd = endCfi ? cfiUtil.compare(sentence.cfi, endCfi) > 0 : false;
            
            if (beforeStart || afterEnd) {
              rendition.display(sentence.cfi);
            }
          }
        } catch {
          // If page-turn check fails, just display the sentence location
          rendition.display(sentence.cfi);
        }
      } catch (e) {
        console.warn('Failed to add highlight', e);
      }
    }
  }, []);

  const clearHighlight = useCallback(() => {
    if (currentHighlightCfiRef.current && renditionRef.current) {
      try {
        renditionRef.current.annotations.remove(currentHighlightCfiRef.current, 'highlight');
      } catch (e) {
        console.warn('Failed to remove highlight', e);
      }
      currentHighlightCfiRef.current = null;
    }
  }, []);

  const handleChapterAudioComplete = useCallback(() => {
    setTtsState('stopped');
    clearHighlight();
    setCurrentTtsIndex(-1);
    renditionRef.current?.next();
  }, [clearHighlight]);

  const extractSentences = useCallback(() => {
    const contents = getActiveContents();
    if (!contents || contents.length === 0) return [];

    const document = contents[0].document;
    if (!document || !document.body) return [];

    const sentences: Array<{ text: string; cfi: string; index: number }> = [];
    
    // 1. Walk DOM to collect all text nodes and build a unified string
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node) {
        const parent = node.parentElement;
        if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let fullText = '';
    const textNodes: Array<{ node: Text; startIdx: number; endIdx: number }> = [];

    let node;
    while ((node = walker.nextNode() as Text)) {
      const text = node.nodeValue || '';
      const startIdx = fullText.length;
      fullText += text;
      textNodes.push({ node, startIdx, endIdx: fullText.length });
    }

    if (!fullText.trim()) return [];

    // 2. Segment the complete text so it properly groups sentences across inline nodes
    const segmenter = new Intl.Segmenter(navigator.language, { granularity: 'sentence' });
    const segments = segmenter.segment(fullText);
    
    let sentenceIndex = 0;

    for (const segment of segments) {
      if (segment.segment.trim().length === 0) continue;

      try {
        const start = segment.index;
        const end = segment.index + segment.segment.length;

        // 3. Map string offsets back to corresponding DOM Text Nodes
        const startNodeInfo = textNodes.find(n => start >= n.startIdx && start < n.endIdx) || textNodes[0];
        
        // Find end node (the end index is exclusive, so it can fall exactly on n.endIdx)
        let endNodeInfo = textNodes.find(n => end > n.startIdx && end <= n.endIdx);
        if (!endNodeInfo) {
          endNodeInfo = textNodes[textNodes.length - 1];
        }

        const startLocalIdx = start - startNodeInfo.startIdx;
        const endLocalIdx = end - endNodeInfo.startIdx;

        // 4. Create precise DOM Range spanning across nodes if necessary
        const range = document.createRange();
        range.setStart(startNodeInfo.node, startLocalIdx);
        range.setEnd(endNodeInfo.node, endLocalIdx);

        // 5. Convert to EpubCFI
        const cfi = new EpubCFI(range, contents[0].cfiBase).toString();

        sentences.push({
          text: segment.segment.trim(),
          cfi,
          index: sentenceIndex++
        });
      } catch (e) {
        console.warn('Failed to create CFI for sentence', e);
      }
    }

    setTtsSentences(sentences);
    ttsSentencesRef.current = sentences;
    return sentences;
  }, [getActiveContents]);

  const handleTtsToggle = useCallback(async () => {
    if (ttsState === 'stopped') {
      const sentences = extractSentences();
      if (sentences.length > 0) {
        setIsTtsPanelOpen(true);
        ttsEngine.speakQueue(sentences, 0, 1);
        setTtsState('playing');
      } else {
        showTtsFeedback('No readable text on this page.');
      }
    } else if (ttsState === 'playing') {
      ttsEngine.pause();
      setTtsState('paused');
    } else if (ttsState === 'paused') {
      ttsEngine.resume();
      setTtsState('playing');
    }
  }, [extractSentences, showTtsFeedback, ttsState]);

  const handleTtsStop = () => {
    ttsEngine.stop();
    setTtsState('stopped');
    clearHighlight();
    setCurrentTtsIndex(-1);
    setIsTtsPanelOpen(false);
  };

  const handlePlayFromSelection = () => {
    if (!selectionCfi) return;
    
    const sentences = ttsSentencesRef.current.length > 0 ? ttsSentencesRef.current : extractSentences();
    if (sentences.length === 0) return;
    
    let startIndex = 0;
    
    // Strategy 1 (primary): CFI comparison — find the sentence containing the selection point
    try {
      const cfiUtil = new EpubCFI();
      for (let i = 0; i < sentences.length; i++) {
        try {
          const comparison = cfiUtil.compare(selectionCfi, sentences[i].cfi);
          if (comparison >= 0) {
            // Selection is at or after this sentence's start — record it
            startIndex = i;
          } else {
            // Past the selection point — the last recorded index is correct
            break;
          }
        } catch { /* skip bad CFI */ }
      }
    } catch { /* CFI comparison failed entirely */ }
    
    // Strategy 2 (fallback): If CFI didn't move us forward, try text matching
    if (startIndex === 0 && selectionTextRef.current) {
      const selNorm = selectionTextRef.current.toLowerCase().replace(/\s+/g, ' ').trim();
      
      for (let i = 0; i < sentences.length; i++) {
        const sNorm = sentences[i].text.toLowerCase().replace(/\s+/g, ' ').trim();
        // Check if the sentence text appears anywhere in the selection (or vice versa)
        if (sNorm.length >= 3 && selNorm.includes(sNorm)) {
          startIndex = i;
          break;
        }
        if (selNorm.length >= 3 && sNorm.includes(selNorm)) {
          startIndex = i;
          break;
        }
        // Partial match: first/last few words of selection appear in sentence
        const selWords = selNorm.split(' ').filter(w => w.length > 2);
        if (selWords.length > 0) {
          const firstWord = selWords[0];
          const idx = sNorm.indexOf(firstWord);
          if (idx >= 0) {
            startIndex = i;
            break;
          }
        }
      }
    }
    
    // Clear selection
    const contents = getActiveContents();
    if (contents && contents.length > 0 && contents[0].window) {
      contents[0].window.getSelection()?.removeAllRanges();
    }
    
    setSelectionCfi(null);
    setSelectionRect(null);
    setSelectionText('');
    selectionTextRef.current = '';
    lastSelectionTimeRef.current = 0;
    setIsTtsPanelOpen(true);
    
    ttsEngine.speakQueue(sentences, startIndex, 1);
    setTtsState('playing');
  };

  const handleVoiceChange = (voiceName: string) => {
    setSelectedVoice(voiceName);
    ttsEngine.setVoice(voiceName).catch((err) => console.error('[EPUBReader] Failed to update TTS voice:', err));
  };

  const handleRateChange = (value: number) => {
    setSpeechRate(value);
    ttsEngine.setRate(value).catch((err) => console.error('[EPUBReader] Failed to update TTS rate:', err));
  };

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  useEffect(() => {
    const loadProgress = async () => {
      const savedProgress = await getProgress(book.id);
      if (savedProgress && savedProgress.lastCfi) {
        setProgress(savedProgress.completionPercentage || 0);
        setReaderLocation(savedProgress.lastCfi);
      }
    };
    loadProgress();

    if (ttsEnabledForBook) {
      ttsEngine.initialize(book.title, book.coverUrl, 0, {
        onPageComplete: handleChapterAudioComplete,
        onPlayStateChange: (playing) => setTtsState(playing ? 'playing' : 'stopped'),
        onError: (err) => console.error('[EPUBReader] TTS Error:', err),
        onSentenceStart: (index) => {
          setCurrentTtsIndex(index);
          highlightSentence(index);
        }
      });
    }

    const handleVisibility = () => ttsEngine.handleVisibilityChange();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      ttsEngine.destroy();
    };
  }, [book.id, book.title, book.coverUrl, ttsEnabledForBook, handleChapterAudioComplete, highlightSentence]);



  // ==========================================================================
  // NAVIGATION & ANIMATION
  // ==========================================================================

  const goToPrev = useCallback(async () => {
    if (navigationLockRef.current) return;
    navigationLockRef.current = true;
    
    // Slide right out
    // await controls.start({ x: 30, opacity: 0, transition: { duration: 0.15 } }); // Removed framer-motion
    renditionRef.current?.prev();
    // Snap to left hidden
    // await controls.start({ x: -30, opacity: 0, transition: { duration: 0 } }); // Removed framer-motion
    // Slide in from left
    // await controls.start({ x: 0, opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } }); // Removed framer-motion
    
    setTimeout(() => { navigationLockRef.current = false; }, 100);
  }, []); // Removed controls from dependency array

  const goToNext = useCallback(async () => {
    if (navigationLockRef.current) return;
    navigationLockRef.current = true;
    
    // Slide left out
    // await controls.start({ x: -30, opacity: 0, transition: { duration: 0.15 } }); // Removed framer-motion
    renditionRef.current?.next();
    // Snap to right hidden
    // await controls.start({ x: 30, opacity: 0, transition: { duration: 0 } }); // Removed framer-motion
    // Slide in from right
    // await controls.start({ x: 0, opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } }); // Removed framer-motion
    
    setTimeout(() => { navigationLockRef.current = false; }, 100);
  }, []); // Removed controls from dependency array

  // ==========================================================================
  // LOCATION & PROGRESS
  // ==========================================================================

  const locationChanged = useCallback(
    async (epubcfi: string) => {
      // Sometimes EPUBJS triggers dummy layout changes without a real cfi on init
      if (!epubcfi) return;

      setIsLoading(false);
      currentCfiRef.current = epubcfi;
      // Calculate progress percentage
      let completionPercentage = 0;
      let currentPage = 1;
      
      if (renditionRef.current) {
        try {
          const currentLocation = renditionRef.current.currentLocation() as ReaderLocationSnapshot | null;
          
          // Try to get percentage from location (works if locations were generated)
          if (currentLocation?.start?.percentage !== undefined && currentLocation.start.percentage > 0) {
            completionPercentage = Math.round(currentLocation.start.percentage * 100);
          } else if (currentLocation?.end?.percentage !== undefined && currentLocation.end.percentage > 0) {
            completionPercentage = Math.round(currentLocation.end.percentage * 100);
          } else {
            // Fallback: estimate progress from spine position
            // epub.js exposes spine as book.spine with .spineItems or .items array
            const epubBook = renditionRef.current.book;
            const spineObj = epubBook.spine as EpubSpineContainer;
            const spineItems: Array<{ href?: string; index?: number }> =
              spineObj?.spineItems ?? spineObj?.items ?? [];
            const spineLength = spineItems.length;

            if (spineLength > 0) {
              const startHref = currentLocation?.start?.href;
              let spineIndex = -1;

              // Method 1: match by start.index (most reliable)
              if (currentLocation?.start?.index !== undefined) {
                spineIndex = currentLocation.start.index;
              }
              // Method 2: match by href
              if (spineIndex < 0 && startHref) {
                spineIndex = spineItems.findIndex(s => {
                  if (!s.href) return false;
                  // Compare the filename part only, stripping any anchors and path prefix
                  const sFile = s.href.split('/').pop()?.split('#')[0] || s.href;
                  const hFile = startHref.split('/').pop()?.split('#')[0] || startHref;
                  return sFile === hFile || startHref.includes(s.href) || s.href.includes(startHref);
                });
              }

              if (spineIndex >= 0) {
                // Use displayed page within the section for finer granularity
                const displayed = currentLocation?.start?.displayed;
                const pageInSection = displayed?.page ?? 1;
                const totalInSection = displayed?.total ?? 1;
                const sectionFraction = pageInSection / Math.max(1, totalInSection);
                completionPercentage = Math.round(((spineIndex + sectionFraction) / spineLength) * 100);
              }
            }
          }
          
          // Get current page/location number for display
          if (currentLocation?.start?.location !== undefined) {
            currentPage = currentLocation.start.location;
          } else if (currentLocation?.start?.displayed?.page !== undefined) {
            currentPage = currentLocation.start.displayed.page;
          }
          
          // Check if at end
          if (currentLocation?.atEnd) {
            completionPercentage = 100;
          }
          
          completionPercentage = Math.min(100, Math.max(0, completionPercentage));
          setProgress(completionPercentage);
          
          // Update chapter name
          const startHref = currentLocation?.start?.href;
          if (startHref && tocRef.current.length > 0) {
            const findChapter = (items: NavItem[]): string | null => {
              for (const item of items) {
                if (startHref.includes(item.href.split('#')[0])) return item.label;
                if (item.subitems) {
                  const found = findChapter(item.subitems);
                  if (found) return found;
                }
              }
              return null;
            };
            const chapter = findChapter(tocRef.current);
            if (chapter) setCurrentChapter(chapter);
          }
        } catch (err) {
          console.warn('[EPUBReader] Error getting location:', err);
        }
      }

      // Save progress to database
      if (epubcfi) {
        try {
          await updateProgress(book.id, currentPage, epubcfi, undefined, completionPercentage);
        } catch (err) {
          console.error('[EPUBReader] Failed to save progress:', err);
        }
      }
    },
    [book.id]
  );

  const processToc = () => {
    if (!spineReadyRef.current || !renditionRef.current?.book) return;
    
    const tocItems = nativeTocRef.current || [];
    const book = renditionRef.current.book;
    
    // Exclusion patterns for garbage/filler TOC labels
    const garbagePatterns = [
      'cover', 'start', 'title page', 'title', 'toc',
      'table of contents', 'contents', 'nav', 'navigation'
    ];
    const garbageRegex = /^index\d*$/i;

    const meaningfulItems = tocItems.filter(t => {
      const lbl = t.label?.toLowerCase().trim() || '';
      if (lbl.length === 0) return false;
      if (garbagePatterns.includes(lbl)) return false;
      if (garbageRegex.test(lbl)) return false;
      return true;
    });

    // Get spine count for quality threshold
    const spineObj = book.spine as any;
    const spineItems = spineObj?.spineItems ?? spineObj?.items ?? [];
    const spineCount = spineItems.length;

    // Accept native TOC only if it has a reasonable number of entries
    // relative to the book's spine. If TOC has <= 2 items but spine has > 3,
    // the native TOC is insufficient — fall through to structural generation.
    const tocIsAdequate = meaningfulItems.length > 2 ||
      (meaningfulItems.length > 0 && spineCount <= 3);

    if (tocIsAdequate) {
      setToc(tocItems);
      tocRef.current = tocItems;
      if (currentChapter === 'Loading...' && tocItems.length > 0) setCurrentChapter(tocItems[0].label);
      return;
    }

    // Generate simple structural "Parts" navigation based on physical spine items
    if (spineItems.length > 0) {
      const structuralToc: NavItem[] = spineItems.map((item: any, idx: number) => {
        // Try to extract a clean name from the filename, otherwise fallback to "Part X"
        const href = item.href || '';
        const filename = href.split('/').pop()?.split('.')[0] || '';
        let label = filename.replace(/[-_]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()).trim();
        
        // If filename is meaningless (like "section-0001", "part1", "index0", etc), normalize it
        if (/^(section|part|chapter|file|body|index|text|ch)[-\s]*\d*$/i.test(label) || !label) {
          label = `Part ${idx + 1}`;
        }

        return {
          id: `spine-${idx}`,
          href: href,
          label: label,
          level: 0
        } as any;
      });

      setToc(structuralToc);
      tocRef.current = structuralToc;
      if (currentChapter === 'Loading...') setCurrentChapter(structuralToc[0].label);
    } else {
      // Last resort: use whatever native TOC exists
      setToc(tocItems);
      tocRef.current = tocItems;
    }
  };

  const handleTocLoaded = async (tocItems: NavItem[]) => {
    // Just store the native TOC. Processing will happen when the spine is ready!
    nativeTocRef.current = tocItems;
    
    // If the spine happened to load BEFORE tocChanged fired, process immediately
    if (spineReadyRef.current) {
      processToc();
    }
  };

  const handleTocClick = (href: string, label: string) => {
    renditionRef.current?.display(href);
    setCurrentChapter(label);
  };

  // ==========================================================================
  // READER SETTINGS
  // ==========================================================================

  const changeFontSize = (delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(50, Math.min(200, prev + delta));
      renditionRef.current?.themes.fontSize(`${next}%`);
      return next;
    });
  };

  const changeLineHeight = (delta: number) => {
    setLineHeight((prev) => {
      const next = Math.max(1.2, Math.min(3, +(prev + delta).toFixed(1)));
      renditionRef.current?.themes.override('line-height', `${next}`);
      return next;
    });
  };

  const switchTheme = (newTheme: ReaderTheme) => {
    setReaderTheme(newTheme);
    const colors = readerThemes[newTheme];
    renditionRef.current?.themes.override('background', colors.pageBg);
    renditionRef.current?.themes.override('color', colors.text);
  };



  const getRendition = (rendition: Rendition) => {
    renditionRef.current = rendition;
    
    // Wire up TOC processing EXACTLY when the spine is guaranteed to be loaded
    rendition.book.loaded.spine.then(() => {
      spineReadyRef.current = true;
      if (nativeTocRef.current) {
        processToc();
      }
    });

    const { pageBg, text } = readerThemes[readerTheme];

    rendition.themes.register('custom', {
      body: {
        background: pageBg,
        color: text,
        'font-family': `"${fontFamily}", sans-serif !important`,
        'box-sizing': 'border-box !important',
      },
      p: {
        'line-height': `${lineHeight} !important`,
        'color': `${text} !important`,
        'background-color': `transparent !important`,
      },
      // Safely force text colors across all typical publisher elements. 
      // The background transparent is needed to punch through publisher backgrounds, except on the body itself.
      'span, div, h1, h2, h3, h4, h5, h6, a, li, blockquote, td, th, b, strong, i, em': {
        'color': `${text} !important`,
        'background-color': `transparent !important`,
        'font-family': 'inherit !important',
        'line-height': `${lineHeight} !important`
      },
      // EXTRA NUCLEAR OPTION for Dark Mode in this block as well
      '*': readerTheme === 'dark' ? {
        'color': `${text} !important`,
        'background-color': `transparent !important`,
      } : {},
      // Visual separation for chapter headings (page breaks don't work in single-column paginated mode)
      'h1, h2, h3': {
        'margin-top': '1.5em'
      },
      // TTS highlight styles
      '.epub-tts-highlight': {
        background: 'rgba(251, 191, 36, 0.35)',
        'border-radius': '2px'
      }
    });
    rendition.themes.select('custom');
    rendition.themes.fontSize(`${fontSize}%`);

    // Inject page-break CSS and scroll separators via content hook
    rendition.hooks.content.register((contents: Contents) => {
      const doc = contents.document;
      const style = doc.createElement('style');
      style.textContent = `
        h1, h2, h3, .chapter-title, .title {
          margin-top: 1.5em !important;
        }
      `;

      // Remove any scroll visual separators, layout is strictly paginated

      // NUCLEAR OPTION for Dark Mode text color overrides!
      if (readerTheme === 'dark') {
        style.textContent += `
          * {
            color: ${text} !important;
            background-color: transparent !important;
            border-color: rgba(255,255,255,0.1) !important;
          }
          html { background-color: ${pageBg} !important; }
          body { background-color: ${pageBg} !important; }
          img, svg, canvas, video, audio { background-color: transparent !important; filter: brightness(0.8) contrast(1.2); }
        `;
      }

      doc.head.appendChild(style);
    });

    // Ensure the loading state clears when rendition completes initial render
    rendition.on('rendered', () => {
      setIsLoading(false);
    });

    // Catch load errors from epub.js
    rendition.book.loaded.metadata.catch((err: unknown) => {
      console.error('[EPUBReader] EPUB metadata load failed:', err);
      setIsLoading(false);
    });

    // NOTE: locations.generate() is intentionally skipped — it blocks the
    // main thread for 2-4 seconds on large books, freezing the UI.
    // Progress is estimated from spine position instead (see locationChanged).

    // Listen for text selection
    rendition.on('selected', (cfiRange: string, contents: Contents) => {
      setSelectionCfi(cfiRange);
      lastSelectionTimeRef.current = Date.now();
      
      // Store selected text for read-from-here matching
      const selection = contents.window.getSelection();
      const selText = selection?.toString().trim() || '';
      setSelectionText(selText);
      selectionTextRef.current = selText;
      
      // Get selection rect to position the popup
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Adjust for iframe offset
        const iframe = contents.document.defaultView?.frameElement;
        if (!iframe) {
          return;
        }
        const iframeRect = iframe.getBoundingClientRect();
        
        setSelectionRect({
          top: rect.top + iframeRect.top,
          left: rect.left + iframeRect.left + (rect.width / 2)
        });
      }
    });

    // Clear selection when clicking elsewhere (guard against race with selection event)
    rendition.on('click', () => {
      if (Date.now() - lastSelectionTimeRef.current < 600) return;
      setSelectionCfi(null);
      setSelectionRect(null);
      setSelectionText('');
      selectionTextRef.current = '';
    });

    // Zen Mode toggle via double click
    rendition.on('dblclick', () => {
      setZenMode(prev => {
        if (!prev) {
          setShowSidebar(false);
          if (activeSidebarTab === 'settings') setActiveSidebarTab('toc');
        }
        return !prev;
      });
    });
  };

  const theme = readerThemes[readerTheme];

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeSidebarTab === 'settings') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goToNext(); }
      if (e.key === ' ' && ttsEnabledForBook) { e.preventDefault(); void handleTtsToggle(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSidebarTab, ttsEnabledForBook, goToPrev, goToNext, handleTtsToggle]);

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

  const handleDrag = async (e: React.MouseEvent) => {
    if (!appWindow) return;
    if (e.buttons === 1) {
      await appWindow.startDragging();
    }
  };
  const toggleFullscreen = async () => {
    if (appWindow) {
      // Tauri fullscreen
      const current = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!current);
      setIsFullscreen(!current);
    } else {
      // Browser fullscreen
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    }
  };

  const renderTocItem = (item: any) => {
    // If the item has our injected custom level, use it to calculate padding indentation.
    const lvl = typeof item.level === 'number' ? item.level : 0;
    const paddingLeft = lvl > 0 ? `${(lvl) * 1.5}rem` : '0rem';
    // Constrain extreme depths
    const boundedPl = lvl > 4 ? '6rem' : paddingLeft;
    
    return (
      <div key={item.id || item.href} className="w-full">
        <button 
          onClick={() => handleTocClick(item.href, item.label)}
          className={`w-full text-left py-2 px-3 rounded-lg text-[12px] transition-colors line-clamp-2
            ${activeSidebarTab === 'toc' && currentChapter === item.label
              ? 'bg-primary/10 text-primary font-semibold'
              : readerTheme === 'dark' ? 'text-gray-300 hover:bg-neutral-800' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          title={item.label}
          style={{ paddingLeft: boundedPl }}
        >
          {item.label}
        </button>
        {/* Render nested subitems if the publisher provided native nested TOC instead of our flat one */}
        {item.subitems && item.subitems.length > 0 && (
          <div className="flex flex-col border-l-2 ml-[0.875rem] border-gray-200 dark:border-neutral-700 pl-1 mt-1">
            {item.subitems.map((sub: NavItem) => {
              const subWithLevel = { ...sub, level: lvl + 1 };
              return renderTocItem(subWithLevel);
            })}
          </div>
        )}
      </div>
    );
  };


  // ==========================================================================
  // Custom EpubJS initialization
  // ==========================================================================

  const updateLocation = async (cfi: string) => {
    currentCfiRef.current = cfi;
    await locationChanged(cfi);
  };

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className={`absolute inset-0 z-10 flex select-none reader-theme reader-theme-${readerTheme}`} style={{ height: '100%' }}>

      {/* Mobile Sidebar Backdrop removed */}

      {/* ════════════════════════ SIDEBAR ════════════════════════ */}
      <aside
        className={`flex-shrink-0 flex flex-col z-30 md:z-20
          transition-[width] duration-300 ease-[cubic-bezier(.16,1,.3,1)] overflow-hidden
          absolute inset-y-0 left-0 h-full md:relative md:inset-auto
          ${showSidebar ? 'w-[85vw] max-w-[300px] md:w-72 shadow-2xl md:shadow-none' : 'w-0'}`}
        style={{ 
          background: readerTheme === 'dark' ? '#1e1e1e' : readerTheme === 'sepia' ? '#f5eedc' : '#ffffff',
          borderRight: `1px solid ${readerTheme === 'dark' ? '#333' : readerTheme === 'sepia' ? '#d4c4a8' : 'rgba(229,231,235,0.7)'}`,
          color: readerTheme === 'dark' ? '#e5e5e5' : readerTheme === 'sepia' ? '#3f2a14' : 'inherit'
        }}
      >
        {/* Sidebar — Book Info */}
        <div className="px-4 pt-4 pb-3 flex-shrink-0">
          <div className="flex items-start gap-3">
            <button
              onClick={onClose}
              className={`mt-0.5 p-1.5 -ml-1 rounded-lg transition-colors ${readerTheme === 'dark' ? 'text-gray-400 hover:text-gray-200 hover:bg-neutral-800' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
              title="Back to Library"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back_ios_new</span>
            </button>
            <div className="flex-1 min-w-0">
              <h1 className={`text-[13px] font-semibold leading-tight line-clamp-2 ${readerTheme === 'dark' ? 'text-gray-100' : 'text-gray-900'}`}>{book.title}</h1>
              <p className={`text-[11px] mt-0.5 truncate ${readerTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{book.author}</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className={`mx-4 border-t ${readerTheme === 'dark' ? 'border-neutral-700' : readerTheme === 'sepia' ? 'border-[#d4c4a8]' : 'border-gray-100'}`} />

        {/* Sidebar — Progress */}
        <div className="px-4 pt-2.5 pb-1 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${readerTheme === 'dark' ? 'text-gray-400' : 'text-gray-400'}`}>Progress</span>
            <span className="text-[11px] font-semibold text-primary tabular-nums">{progress}%</span>
          </div>
          <div className={`h-1 rounded-full overflow-hidden ${readerTheme === 'dark' ? 'bg-neutral-800' : 'bg-gray-100'}`}>
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Sidebar — Tabs (icon-only) */}
        <div className={`flex items-center border-b flex-shrink-0 ${readerTheme === 'dark' ? 'border-neutral-700' : readerTheme === 'sepia' ? 'border-[#d4c4a8]' : 'border-gray-100'}`}>
          {(['toc', 'bookmarks', 'settings'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSidebarTab(tab)}
              className={`flex-1 py-2.5 transition-colors relative flex items-center justify-center
                ${activeSidebarTab === tab ? 'text-primary' : readerTheme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
              title={tab === 'toc' ? 'Table of Contents' : tab === 'bookmarks' ? 'Bookmarks' : 'Settings'}
            >
              <span className="material-symbols-outlined text-[18px]">
                {tab === 'toc' ? 'list' : tab === 'bookmarks' ? 'bookmark' : 'tune'}
              </span>
              {activeSidebarTab === tab && (
                <div className="absolute bottom-0 inset-x-3 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* Sidebar — Tab Content */}
        <div className={`flex-1 overflow-hidden relative ${readerTheme === 'dark' ? 'bg-[#1a1a1a]' : readerTheme === 'sepia' ? 'bg-[#f0e7d3]' : 'bg-gray-50/30'}`}>
          
          {/* TOC Tab */}
          {activeSidebarTab === 'toc' && (
            <div className="absolute inset-0 overflow-y-auto scrollbar-thin p-2">
              {toc.length > 0 ? (
                toc.map((item) => renderTocItem(item))
              ) : (
                <div className="p-4 text-center text-gray-400 text-sm">
                  {isLoading ? 'Loading chapters...' : 'No chapters found'}
                </div>
              )}
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
            <div className="absolute inset-0 overflow-y-auto overflow-x-hidden p-3 space-y-4 scrollbar-thin">

              {/* ── Theme ── */}
              <div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider block mb-2 ${readerTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Theme</span>
                <div className={`flex items-center rounded-lg p-0.5 gap-0.5 ${readerTheme === 'dark' ? 'bg-neutral-800' : readerTheme === 'sepia' ? 'bg-[#eaddc5]' : 'bg-gray-100'}`}>
                  {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => switchTheme(t)}
                      className={`flex-1 h-8 rounded-md flex items-center justify-center gap-1.5 text-[10px] font-medium transition-all capitalize
                        ${readerTheme === t 
                          ? (readerTheme === 'dark' ? 'bg-[#333] text-primary shadow-sm' : 'bg-white text-primary shadow-sm') 
                          : (readerTheme === 'dark' ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700')}`}
                    >
                      <div className={`w-3 h-3 rounded-full border ${readerTheme === 'dark' ? 'border-neutral-600' : 'border-gray-300'}`} style={{ background: readerThemes[t].pageBg }} />
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Font ── */}
              <div>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-2">Font</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'Literata', label: 'Literata' },
                    { id: 'Inter', label: 'Inter' },
                    { id: 'Georgia', label: 'Georgia' },
                    { id: 'system-ui', label: 'System' }
                  ].map((font) => (
                    <button
                      key={font.id}
                      onClick={() => {
                        setFontFamily(font.id);
                        renditionRef.current?.themes.font(
                          font.id !== 'system-ui' ? font.id : 'Helvetica, Arial, sans-serif'
                        );
                      }}
                      className={`h-7 px-2.5 rounded-lg text-[10px] font-semibold transition-all border
                        ${fontFamily === font.id
                          ? (readerTheme === 'dark' ? ' border-primary bg-primary/10 text-primary' : 'border-primary bg-primary/5 text-primary')
                          : (readerTheme === 'dark' ? 'border-neutral-700 bg-neutral-800 text-gray-300 hover:border-neutral-600' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300')
                        }`}
                      style={{ fontFamily: font.id !== 'system-ui' ? `"${font.id}", serif` : 'inherit' }}
                    >
                      {font.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Font Size ── */}
              <div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider block mb-1.5 ${readerTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>Size</span>
                <div className={`flex items-center justify-between border rounded-lg h-8 px-0.5 ${readerTheme === 'dark' ? 'bg-neutral-800 border-neutral-700' : readerTheme === 'sepia' ? 'bg-[#fcf8f0] border-[#d4c4a8]' : 'bg-white border-gray-200'}`}>
                  <button onClick={() => changeFontSize(-10)} className={`w-7 h-7 rounded flex items-center justify-center ${readerTheme === 'dark' ? 'text-gray-400 hover:bg-neutral-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                    <span className="material-symbols-outlined text-[16px]">remove</span>
                  </button>
                  <span className={`text-[11px] font-semibold tabular-nums ${readerTheme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>{fontSize}%</span>
                  <button onClick={() => changeFontSize(10)} className={`w-7 h-7 rounded flex items-center justify-center ${readerTheme === 'dark' ? 'text-gray-400 hover:bg-neutral-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>
              </div>

              {/* ── Line Spacing ── */}
              <div>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Line Spacing</span>
                <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg h-8 px-0.5">
                  <button onClick={() => changeLineHeight(-0.2)} className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-50">
                    <span className="material-symbols-outlined text-[16px]">remove</span>
                  </button>
                  <span className="text-[11px] font-semibold text-gray-700 tabular-nums">{lineHeight.toFixed(1)}</span>
                  <button onClick={() => changeLineHeight(0.2)} className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-50">
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>
              </div>

              {/* ── Letter Spacing ── */}
              <div>
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">Letter Spacing</span>
                <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg h-8 px-0.5">
                  <button onClick={() => { setLetterSpacing(l => Math.max(0, l - 0.5)); renditionRef.current?.themes.override('letter-spacing', `${Math.max(0, letterSpacing - 0.5)}px`); }} className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-50">
                    <span className="material-symbols-outlined text-[16px]">remove</span>
                  </button>
                  <span className="text-[11px] font-semibold text-gray-700 tabular-nums">{letterSpacing.toFixed(1)}px</span>
                  <button onClick={() => { setLetterSpacing(l => Math.min(3, l + 0.5)); renditionRef.current?.themes.override('letter-spacing', `${Math.min(3, letterSpacing + 0.5)}px`); }} className="w-7 h-7 rounded flex items-center justify-center text-gray-500 hover:bg-gray-50">
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>
              </div>

              {/* ── AI Voice (TTS) ── */}
              {ttsEnabledForBook && (
                <div>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider block mb-2 ${readerTheme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>AI Voice</span>
                  <select
                    value={selectedVoice}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    className={`w-full text-[11px] font-medium rounded-lg px-2.5 py-2 border focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer
                      ${readerTheme === 'dark' ? 'bg-neutral-800 border-neutral-700 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`}
                  >
                    <option value="">Auto (Best Available)</option>
                    {availableVoices.map((voice) => (
                      <option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name}</option>
                    ))}
                  </select>
                </div>
              )}

            </div>
          )}

        </div>

        {/* Sidebar — Footer */}
        <div className={`px-3 py-2 border-t flex-shrink-0 ${readerTheme === 'dark' ? 'border-neutral-700' : readerTheme === 'sepia' ? 'border-[#d4c4a8]' : 'border-gray-100'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-medium ${readerTheme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>{toc.length} chapters</span>
            <button
              onClick={() => setShowSidebar(false)}
              className={`p-1.5 rounded-lg transition-colors ${readerTheme === 'dark' ? 'text-gray-500 hover:text-gray-300 hover:bg-neutral-800' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
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
          onMouseDown={appWindow ? handleDrag : undefined}
          onDoubleClick={appWindow ? handleDoubleClickTitleBar : undefined}
          className={`h-10 sm:h-11 flex-shrink-0 flex items-center px-2 gap-1 backdrop-blur-md z-10 overflow-x-auto scrollbar-hide cursor-default select-none transition-all duration-300 origin-top
            ${zenMode ? '-translate-y-full opacity-0 pointer-events-none absolute w-full' : 'translate-y-0 opacity-100 relative'}`}
          style={{
            background: readerTheme === 'dark' ? 'rgba(30,30,30,0.95)' : readerTheme === 'sepia' ? 'rgba(245,238,220,0.95)' : 'rgba(255,255,255,0.95)',
            borderBottom: `1px solid ${readerTheme === 'dark' ? '#333' : readerTheme === 'sepia' ? '#d4c4a8' : 'rgba(229,231,235,0.6)'}`,
            color: readerTheme === 'dark' ? '#e5e5e5' : 'inherit'
          }}
        >

          {/* Left: sidebar toggle + chapter name */}
          <div className="flex items-center gap-0.5 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
            {!showSidebar && (
              <TBtn onClick={() => setShowSidebar(true)} title="Show sidebar">
                <span className="material-symbols-outlined text-[20px]">left_panel_open</span>
              </TBtn>
            )}
            <span className="text-[13px] font-medium text-gray-600 truncate max-w-[120px] sm:max-w-[180px] ml-1">{currentChapter}</span>
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
                title="AI Voice"
              >
                <span className="material-symbols-outlined text-[16px]">{ttsState === 'playing' ? 'graphic_eq' : 'headset'}</span>
                <span className="hidden sm:inline">{ttsState === 'playing' ? 'Playing' : ttsState === 'paused' ? 'Paused' : 'AI Voice'}</span>
              </button>
            )}

            <div className="w-px h-5 bg-gray-200 mx-1 shrink-0" />

            <TBtn onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
              <span className="material-symbols-outlined text-[18px]">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
            </TBtn>

            <TBtn onClick={onClose} title="Close reader" className="hover:!bg-red-50 hover:!text-red-500">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </TBtn>
          </div>
        </header>

        {/* ─── Book Reading Area ─── */}
        <div className="flex-1 overflow-hidden relative flex justify-center items-center py-2 sm:py-6" style={{ background: theme.bg }}>

          {/* Centered Page Container — strictly paginated single A4 page view */}
          <div className="relative transition-all duration-500 ease-out overflow-hidden group rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.06)] ring-1 ring-gray-900/5"
               style={{ 
                 background: theme.pageBg, 
                 width: '100%',
                 height: '100%',
                 maxWidth: 'calc(95vh * 0.707)', /* Perfect single page portrait A4/A5 */
                 maxHeight: '95vh',
                 aspectRatio: '1 / 1.414',
                 margin: '0 auto'
               }}>

            <div
              className="relative w-full h-full overflow-hidden px-4 py-4 sm:px-12 sm:py-8"
            >
              
              
              {readerMounted && (
                // Re-inject on theme change
                <EpubView
                  key={`${readerTheme}`}
                  url={fileUrl as string | ArrayBuffer}
                  location={readerLocation}
                  locationChanged={(cfi) => {
                    setReaderLocation(cfi as string);
                    updateLocation(cfi as string);
                  }}
                  tocChanged={(newToc: NavItem[]) => {
                    handleTocLoaded(newToc);
                    setIsLoading(false);
                  }}
                  getRendition={getRendition}
                  epubOptions={{
                    width: '100%',
                    height: '100%',
                    manager: 'default',
                    flow: 'paginated',
                    spread: 'none',
                    minSpreadWidth: 99999, // Force disable spread
                    allowScriptedContent: true
                  }}
                  epubViewStyles={{
                    viewHolder: { position: 'relative', height: '100%', width: '100%' },
                    view: { height: '100%', width: '100%' }
                  }}
                  loadingView={
                    <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: theme.pageBg }}>
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative w-10 h-10">
                          <div className="absolute inset-0 rounded-full border-2 border-gray-200" />
                          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                        </div>
                        <p className="text-[13px] font-medium text-gray-400">Opening book…</p>
                      </div>
                    </div>
                  }
                  errorView={
                    <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: theme.pageBg }}>
                      <div className="flex flex-col items-center gap-4 px-8 text-center">
                        <span className="material-symbols-outlined text-[40px] text-red-400">error_outline</span>
                        <p className="text-sm font-medium text-gray-500">Failed to load the book. The file may be corrupted.</p>
                      </div>
                    </div>
                  }
                />
              )}
            </div>
          </div>

          {/* Navigation Arrows */}
          <>
            <button
              onClick={goToPrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 flex items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-lg hover:bg-white transition-all"
            >
              <span className="material-symbols-outlined text-[28px]">navigate_before</span>
            </button>
            <button
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-20 w-12 h-12 flex items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-lg hover:bg-white transition-all"
            >
              <span className="material-symbols-outlined text-[28px]">navigate_next</span>
            </button>
          </>

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
              <button onClick={() => ttsEngine.playPreviousSentence()} className="w-8 h-8 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors" title="Previous sentence">
                <span className="material-symbols-outlined text-[20px]">skip_previous</span>
              </button>
              <button onClick={() => ttsEngine.playNextSentence()} className="w-8 h-8 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors" title="Next sentence">
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
                <div className="relative flex items-center bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg pl-2.5 pr-1 py-1 transition-colors group">
                  <select value={selectedVoice} onChange={(e) => handleVoiceChange(e.target.value)} className="appearance-none bg-transparent text-[13px] font-semibold text-gray-700 focus:outline-none cursor-pointer pr-5 max-w-[140px] truncate outline-none z-10" title="Voice">
                    <option value="">Auto</option>
                    {availableVoices.map((voice) => (<option key={`${voice.name}-${voice.lang}`} value={voice.name}>{voice.name.replace('Microsoft ', '').replace(' Desktop', '')}</option>))}
                  </select>
                  <span className="material-symbols-outlined absolute right-1.5 text-[16px] pointer-events-none text-gray-400 group-hover:text-gray-600 z-0">expand_more</span>
                </div>
              </div>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button onClick={() => setIsTtsPanelOpen(false)} className="w-8 h-8 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-colors" title="Hide toolbar">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>



          </div>
        </div>
      )}

      {/* ════════════════════════ READ FROM HERE POPUP ════════════════════════ */}
      {selectionCfi && selectionRect && (
        <div 
          className="fixed z-50 animate-fade-in"
          style={{ 
            top: `${selectionRect.top - 40}px`, 
            left: `${selectionRect.left}px`,
            transform: 'translateX(-50%)'
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); handlePlayFromSelection(); }}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 hover:bg-gray-800 active:bg-gray-700 transition-colors touch-manipulation"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
            <span className="text-[13px] font-medium whitespace-nowrap">Read from here</span>
          </button>
          {/* Triangle pointer */}
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-gray-900 rotate-45" />
        </div>
      )}




    </div>
  );
}
