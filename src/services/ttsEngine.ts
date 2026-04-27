/**
 * Invron E-Library - Text-to-Speech Engine (Native Only)
 * 
 * Features:
 * - Uses native Web Speech API (window.speechSynthesis)
 * - English-only TTS support
 * - Advanced text preprocessing for natural PDF/EPUB narration
 * - Screen Wake Lock to prevent sleep during playback
 * - Media Session API for lock screen controls
 * - Silent audio loop for Android background persistence
 */

import { getSettings, updateSettings, type UserSettings } from '../db';

// ============================================================================
// TYPES
// ============================================================================

export interface TTSState {
  isPlaying: boolean;
  isPaused: boolean;
  currentPage: number;
  totalPages: number;
  currentUtterance: SpeechSynthesisUtterance | null;
  queue: Array<{ text: string; index: number }>;
  currentQueueIndex: number;
}

export interface TTSOptions {
  rate?: number;          // 0.5 - 2.0 (default: 1.0)
  pitch?: number;         // 0 - 2 (default: 1.0)
  voiceName?: string;     // Preferred voice
}

export interface TTSCallbacks {
  onPageComplete?: (page: number) => void;
  onPlayStateChange?: (isPlaying: boolean) => void;
  onError?: (error: string) => void;
  onSentenceStart?: (index: number, text: string) => void;
  onSentenceEnd?: (index: number) => void;
}

// ============================================================================
// PRONUNCIATION DICTIONARY (English Academic Terms)
// ============================================================================

const PRONUNCIATION_MAP: Record<string, string> = {
  // ── Chemical Formulas ──
  'CO2': 'Carbon Dioxide',
  'H2O': 'Water',
  'O2': 'Oxygen',
  'N2': 'Nitrogen',
  'NaCl': 'Sodium Chloride',
  'H2SO4': 'Sulphuric Acid',
  'HCl': 'Hydrochloric Acid',
  'CaCO3': 'Calcium Carbonate',
  'NaOH': 'Sodium Hydroxide',
  'KMnO4': 'Potassium Permanganate',

  // ── Science Acronyms ──
  'DNA': 'D N A',
  'RNA': 'R N A',
  'ATP': 'A T P',
  'UV': 'Ultra Violet',
  'IR': 'Infrared',
  'pH': 'p H',
  'AC': 'A C',
  'DC': 'D C',

  // ── Titles ──
  'Dr.': 'Doctor',
  'Mr.': 'Mister',
  'Mrs.': 'Misses',
  'Ms.': 'Miss',
  'Jr.': 'Junior',
  'Sr.': 'Senior',
  'Prof.': 'Professor',
  'St.': 'Saint',
  'Rev.': 'Reverend',

  // ── Common Abbreviations ──
  'Fig.': 'Figure',
  'fig.': 'figure',
  'Figs.': 'Figures',
  'figs.': 'figures',
  'etc.': 'etcetera',
  'vs.': 'versus',
  'e.g.': 'for example',
  'i.e.': 'that is',
  'viz.': 'namely',
  'cf.': 'compare',
  'approx.': 'approximately',
  'incl.': 'including',
  'excl.': 'excluding',
  'govt.': 'government',
  'dept.': 'department',
  'Dept.': 'Department',
  'assn.': 'association',
  'corp.': 'corporation',
  'org.': 'organization',

  // ── Academic Abbreviations ──
  'Ch.': 'Chapter',
  'ch.': 'chapter',
  'Sec.': 'Section',
  'sec.': 'section',
  'Vol.': 'Volume',
  'vol.': 'volume',
  'No.': 'Number',
  'no.': 'number',
  'Nos.': 'Numbers',
  'nos.': 'numbers',
  'p.': 'page',
  'pp.': 'pages',
  'Ed.': 'Edition',
  'ed.': 'edition',
  'Ref.': 'Reference',
  'ref.': 'reference',
  'Ans.': 'Answer',
  'ans.': 'answer',
  'Ques.': 'Question',
  'ques.': 'question',
  'Q.': 'Question',
  'A.': 'Answer',
  'Ex.': 'Exercise',
  'ex.': 'exercise',
  'Expt.': 'Experiment',
  'expt.': 'experiment',
  'Eq.': 'Equation',
  'eq.': 'equation',
  'Eqs.': 'Equations',
  'eqs.': 'equations',
  'Soln.': 'Solution',
  'soln.': 'solution',
  'Defn.': 'Definition',
  'defn.': 'definition',
  'Thm.': 'Theorem',
  'thm.': 'theorem',
  'Prop.': 'Proposition',
  'prop.': 'proposition',
  'Cor.': 'Corollary',
  'cor.': 'corollary',

  // ── Units of Measurement ──
  'km': 'kilometers',
  'cm': 'centimeters',
  'mm': 'millimeters',
  'kg': 'kilograms',
  'mg': 'milligrams',
  'ml': 'milliliters',
  'sq.': 'square',
  'cu.': 'cubic',
  '°C': 'degrees Celsius',
  '°F': 'degrees Fahrenheit',
  'km/h': 'kilometers per hour',
  'm/s': 'meters per second',

  // ── Math Symbols (expanded in context) ──
  '≈': 'approximately equals',
  '≠': 'is not equal to',
  '≤': 'is less than or equal to',
  '≥': 'is greater than or equal to',
  '∞': 'infinity',
  '∴': 'therefore',
  '∵': 'because',
  '∈': 'belongs to',
  '⊂': 'is a subset of',
  '∩': 'intersection',
  '∪': 'union',
  'π': 'pi',
  '√': 'square root of',
};

// ── Roman Numerals → Spoken Numbers ──
const ROMAN_MAP: Record<string, string> = {
  'I': 'one', 'II': 'two', 'III': 'three', 'IV': 'four', 'V': 'five',
  'VI': 'six', 'VII': 'seven', 'VIII': 'eight', 'IX': 'nine', 'X': 'ten',
  'XI': 'eleven', 'XII': 'twelve', 'XIII': 'thirteen', 'XIV': 'fourteen',
  'XV': 'fifteen', 'XVI': 'sixteen', 'XVII': 'seventeen', 'XVIII': 'eighteen',
  'XIX': 'nineteen', 'XX': 'twenty',
};

// ── Ordinal Number Suffixes ──
const ORDINAL_SUFFIXES: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth',
  6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth',
  11: 'eleventh', 12: 'twelfth', 13: 'thirteenth', 14: 'fourteenth',
  15: 'fifteenth', 16: 'sixteenth', 17: 'seventeenth', 18: 'eighteenth',
  19: 'nineteenth', 20: 'twentieth',
};

// ============================================================================
// TTS ENGINE CLASS
// ============================================================================

export class TTSEngine {
  private state: TTSState;
  private wakeLock: WakeLockSentinel | null = null;
  private silentAudio: HTMLAudioElement | null = null;
  private callbacks: TTSCallbacks = {};
  private settings: UserSettings | null = null;

  constructor() {
    this.state = {
      isPlaying: false,
      isPaused: false,
      currentPage: 0,
      totalPages: 0,
      currentUtterance: null,
      queue: [],
      currentQueueIndex: -1
    };
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize the TTS engine with book metadata for lock screen display
   */
  async initialize(
    bookTitle: string,
    coverUrl: string,
    totalPages: number,
    callbacks: TTSCallbacks = {}
  ): Promise<void> {
    this.callbacks = callbacks;
    this.state.totalPages = totalPages;
    this.settings = await getSettings();

    // Setup Media Session for lock screen controls
    this.setupMediaSession(bookTitle, coverUrl);

    // Create silent audio for Android background persistence
    this.setupSilentAudio();

    console.log('[TTS] Engine initialized');
  }

  /**
   * Setup Media Session API for lock screen controls
   */
  private setupMediaSession(title: string, coverUrl: string): void {
    if (!('mediaSession' in navigator)) {
      console.warn('[TTS] Media Session API not supported');
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: title,
      artist: 'Invron E-Library',
      album: 'Audiobook',
      artwork: coverUrl ? [
        { src: coverUrl, sizes: '512x512', type: 'image/webp' }
      ] : []
    });

    navigator.mediaSession.setActionHandler('play', () => this.resume());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('stop', () => this.stop());
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (this.state.queue.length > 0) {
        this.playPreviousSentence();
      }
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (this.state.queue.length > 0) {
        this.playNextSentence();
      }
    });
  }

  /**
   * Setup silent audio loop for Android background persistence
   */
  private setupSilentAudio(): void {
    // Create a short silent audio programmatically
    this.silentAudio = new Audio();
    
    // Base64 encoded 1-second silent MP3
    const silentMp3 = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYM/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//tQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
    
    this.silentAudio.src = silentMp3;
    this.silentAudio.loop = true;
    this.silentAudio.volume = 0.01; // Nearly silent
  }

  // ==========================================================================
  // WAKE LOCK MANAGEMENT
  // ==========================================================================

  /**
   * Acquire screen wake lock to prevent device sleep
   */
  private async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      console.warn('[TTS] Wake Lock API not supported');
      return;
    }

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      console.log('[TTS] Wake lock acquired');

      this.wakeLock.addEventListener('release', () => {
        console.log('[TTS] Wake lock released');
      });
    } catch (err) {
      console.error('[TTS] Failed to acquire wake lock:', err);
    }
  }

  /**
   * Release screen wake lock
   */
  private async releaseWakeLock(): Promise<void> {
    if (this.wakeLock) {
      await this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  /**
   * Re-acquire wake lock when app becomes visible again
   */
  handleVisibilityChange(): void {
    if (document.visibilityState === 'visible' && this.state.isPlaying) {
      this.acquireWakeLock();
    }
  }

  // ==========================================================================
  // TEXT PREPROCESSING
  // ==========================================================================

  /**
   * Normalize text for better TTS pronunciation.
   * Pipeline:
   *   1. Merge hyphenated line breaks
   *   2. Remove TOC/index dot-leader lines
   *   3. Expand abbreviations
   *   4. Expand ordinal numbers
   *   5. Expand Roman numerals in context
   *   6. Clean bullet/list prefixes
   *   7. Normalize quotes & Unicode
   *   8. Clean excessive whitespace
   */
  normalizeText(rawText: string): string {
    let text = rawText;

    // 1. Merge hyphenated line-breaks: "un-\n  believable" → "unbelievable"
    text = text.replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2');

    // 2. Remove TOC / index dot-leader lines: "Chapter 1 .......... 24"
    text = text.replace(/^.*[.·…]{4,}\s*\d+\s*$/gm, '');

    // 3. Remove standalone page number lines (e.g. just "42" or "— 42 —")
    text = text.replace(/^\s*[—\-–]*\s*\d{1,4}\s*[—\-–]*\s*$/gm, '');

    // 4. Replace abbreviations with full words (longest-match-first)
    const sortedAbbrs = Object.entries(PRONUNCIATION_MAP)
      .sort(([a], [b]) => b.length - a.length);
    for (const [abbr, full] of sortedAbbrs) {
      // Escape special regex characters in the abbreviation
      const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<=^|\\s|[("'])${escaped}(?=$|\\s|[,;:!?)"'])`, 'g');
      text = text.replace(regex, full);
    }

    // 5. Expand ordinal numbers: "1st" → "first", "23rd" → "23rd" (keep if > 20)
    text = text.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, (_match, num, _suffix) => {
      const n = parseInt(num, 10);
      return ORDINAL_SUFFIXES[n] || `${num}${_suffix}`;
    });

    // 6. Expand standalone Roman numerals in chapter/section context
    //    "Chapter IV" → "Chapter four", "(iii)" → "(three)"
    text = text.replace(
      /(?:(?:Chapter|Section|Part|Unit|Lesson|Act|Scene)\s+)(I{1,3}|IV|V|VI{0,3}|IX|X{1,2}|XI{0,3}|XIV|XV|XVI{0,3}|XIX|XX)\b/gi,
      (match, roman) => {
        const spoken = ROMAN_MAP[roman.toUpperCase()];
        return spoken ? match.replace(roman, spoken) : match;
      }
    );
    // Parenthesized small Roman: (i), (ii), (iii), (iv), (v)
    text = text.replace(
      /\((i{1,3}|iv|v|vi{0,3}|ix|x)\)/gi,
      (_match, roman) => {
        const spoken = ROMAN_MAP[roman.toUpperCase()];
        return spoken ? `(${spoken})` : _match;
      }
    );

    // 7. Clean bullet / list numbering prefixes for natural reading
    //    "a)" → "a.", "(a)" → "a.", "1." stays, "•" removed
    text = text.replace(/^[ \t]*[a-zA-Z]\)\s*/gm, '');
    text = text.replace(/^[ \t]*\([a-zA-Z]\)\s*/gm, '');

    // 8. Remove common non-readable characters & decorative symbols
    text = text.replace(/[•·►▪▸◆■□●○★☆✓✗✦✧▶◀▲▼◄]/g, '');

    // 9. Normalize quotes and dashes
    text = text.replace(/[\u2018\u2019\u201A\u201B]/g, "'");  // Smart single quotes → '
    text = text.replace(/[\u201C\u201D\u201E\u201F]/g, '"');  // Smart double quotes → "
    text = text.replace(/[\u2013\u2014\u2015]/g, ', ');         // Em/en dashes → comma pause

    // 10. Remove zero-width & invisible Unicode characters
    text = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');

    // 11. Collapse excessive whitespace and newlines  
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]+/g, ' ');

    // 12. Remove lines that are only whitespace or punctuation
    text = text.replace(/^\s*[.\-_=*#~]+\s*$/gm, '');

    return text.trim();
  }

  /**
   * Filter text from PDF header/footer regions
   * @param items - Text items from PDF.js getTextContent()
   * @param pageHeight - Total page height in points
   * @param marginTop - Top margin to ignore (default 50 points)
   * @param marginBottom - Bottom margin to ignore (default 50 points)
   */
  filterPDFText(
    items: Array<{ str: string; transform: number[] }>,
    pageHeight: number,
    marginTop = 50,
    marginBottom = 50
  ): string {
    const filteredItems = items.filter(item => {
      const y = item.transform[5]; // Y position from transform matrix
      return y > marginBottom && y < (pageHeight - marginTop);
    });

    const rawText = filteredItems.map(item => item.str).join(' ');
    return this.normalizeText(rawText);
  }

  // ==========================================================================
  // VOICE SELECTION
  // ==========================================================================

  /**
   * Get the best available English voice
   */
  getBestEnglishVoice(): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();

    // If user has a preferred voice, try to use it
    if (this.settings?.ttsVoice) {
      const preferred = voices.find(v => v.name === this.settings?.ttsVoice);
      if (preferred) return preferred;
    }

    // Priority 1: Google US English (high quality on Android)
    const googleUS = voices.find(v => v.name === 'Google US English');
    if (googleUS) return googleUS;

    // Priority 2: Any en-US voice
    const usVoice = voices.find(v => v.lang === 'en-US');
    if (usVoice) return usVoice;

    // Priority 3: Any English voice
    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) return englishVoice;

    return voices[0] || null;
  }

  /**
   * Check if English TTS is available on this device
   */
  isEnglishVoiceAvailable(): boolean {
    const voices = window.speechSynthesis.getVoices();
    return voices.some(v => v.lang.startsWith('en'));
  }

  /**
   * Get all available voices (for settings UI)
   */
  getAvailableVoices(): SpeechSynthesisVoice[] {
    return window.speechSynthesis.getVoices();
  }

  // ==========================================================================
  // SETTINGS HELPERS
  // ==========================================================================

  /**
   * Reload settings from IndexedDB so the cached this.settings
   * reflects changes made externally (e.g. voice change in UI).
   */
  async reloadSettings(): Promise<void> {
    this.settings = await getSettings();
  }

  // ==========================================================================
  // PLAYBACK CONTROL
  // ==========================================================================

  /**
   * Speak a queue of sentences (used for EPUB highlighting)
   */
  async speakQueue(
    items: Array<{ text: string; index: number }>,
    startIndex: number = 0,
    page: number
  ): Promise<void> {
    // Always refresh cached settings so we see the latest voice choice
    await this.reloadSettings();

    this.state.queue = items;
    this.state.currentQueueIndex = startIndex;
    this.state.currentPage = page;
    
    await this.playCurrentQueueItem();
  }

  private async playCurrentQueueItem(): Promise<void> {
    if (this.state.currentQueueIndex >= this.state.queue.length || this.state.currentQueueIndex < 0) {
      this.callbacks.onPageComplete?.(this.state.currentPage);
      return;
    }

    const item = this.state.queue[this.state.currentQueueIndex];
    
    // Stop any existing speech
    window.speechSynthesis.cancel();

    if (!item.text.trim()) {
      this.state.currentQueueIndex++;
      return this.playCurrentQueueItem();
    }

    // Acquire wake lock and start silent audio
    await this.acquireWakeLock();
    this.silentAudio?.play().catch(() => {});

    const utterance = new SpeechSynthesisUtterance(item.text);
    
    const voice = this.getBestEnglishVoice();
    if (voice) utterance.voice = voice;

    utterance.rate = this.settings?.ttsRate || 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      this.state.isPlaying = true;
      this.state.isPaused = false;
      navigator.mediaSession.playbackState = 'playing';
      this.callbacks.onPlayStateChange?.(true);
      this.callbacks.onSentenceStart?.(item.index, item.text);
    };

    utterance.onend = () => {
      this.callbacks.onSentenceEnd?.(item.index);
      // Only proceed if we haven't been stopped or paused
      if (this.state.isPlaying && !this.state.isPaused) {
        this.state.currentQueueIndex++;
        this.playCurrentQueueItem();
      }
    };

    utterance.onerror = (event) => {
      // Ignore 'interrupted' errors which happen when we cancel speech manually
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      
      console.error('[TTS] Speech error:', event.error);
      this.callbacks.onError?.(event.error);
      this.stop();
    };

    this.state.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  playNextSentence(): void {
    if (this.state.queue.length === 0) return;
    this.state.currentQueueIndex = Math.min(this.state.queue.length - 1, this.state.currentQueueIndex + 1);
    this.playCurrentQueueItem();
  }

  playPreviousSentence(): void {
    if (this.state.queue.length === 0) return;
    this.state.currentQueueIndex = Math.max(0, this.state.currentQueueIndex - 1);
    this.playCurrentQueueItem();
  }

  /**
   * Speak text for a specific page (Legacy/PDF mode)
   * @param text - The text to speak
   * @param page - Current page number
   * @param onComplete - Callback when this page's audio finishes
   */
  async speak(
    text: string,
    page: number,
    onComplete?: () => void
  ): Promise<void> {
    // Stop any existing speech
    window.speechSynthesis.cancel();

    if (!text.trim()) {
      console.warn('[TTS] Empty text, skipping');
      onComplete?.();
      return;
    }

    // Acquire wake lock and start silent audio
    await this.acquireWakeLock();
    this.silentAudio?.play().catch(() => {
      // Autoplay may be blocked, that's okay
    });

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice
    const voice = this.getBestEnglishVoice();
    if (voice) {
      utterance.voice = voice;
    }

    // Apply settings
    utterance.rate = this.settings?.ttsRate || 1.0;
    utterance.pitch = 1.0;

    // Event handlers
    utterance.onstart = () => {
      this.state.isPlaying = true;
      this.state.isPaused = false;
      this.state.currentPage = page;
      navigator.mediaSession.playbackState = 'playing';
      this.callbacks.onPlayStateChange?.(true);
    };

    utterance.onend = () => {
      this.callbacks.onPageComplete?.(page);
      onComplete?.();
    };

    utterance.onerror = (event) => {
      console.error('[TTS] Speech error:', event.error);
      this.callbacks.onError?.(event.error);
      this.stop();
    };

    this.state.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state.isPlaying && !this.state.isPaused) {
      window.speechSynthesis.pause();
      this.state.isPaused = true;
      navigator.mediaSession.playbackState = 'paused';
      this.callbacks.onPlayStateChange?.(false);
    }
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this.state.isPaused) {
      window.speechSynthesis.resume();
      this.state.isPaused = false;
      navigator.mediaSession.playbackState = 'playing';
      this.callbacks.onPlayStateChange?.(true);
    }
  }

  /**
   * Stop playback completely
   */
  async stop(): Promise<void> {
    window.speechSynthesis.cancel();
    
    this.state.isPlaying = false;
    this.state.isPaused = false;
    this.state.currentUtterance = null;
    this.state.queue = [];
    this.state.currentQueueIndex = -1;
    
    navigator.mediaSession.playbackState = 'none';
    
    // Stop silent audio
    this.silentAudio?.pause();
    
    // Release wake lock
    await this.releaseWakeLock();
    
    this.callbacks.onPlayStateChange?.(false);
  }

  /**
   * Set speech rate
   */
  async setRate(rate: number): Promise<void> {
    const clampedRate = Math.max(0.5, Math.min(2.0, rate));
    await updateSettings({ ttsRate: clampedRate });
    this.settings = await getSettings();
    
    // Restart current utterance if playing
    if (this.state.isPlaying && !this.state.isPaused && this.state.queue.length > 0) {
      this.playCurrentQueueItem();
    }
  }

  /**
   * Set preferred voice
   */
  async setVoice(voiceName: string): Promise<void> {
    await updateSettings({ ttsVoice: voiceName });
    this.settings = await getSettings();
    
    // Restart current utterance if playing
    if (this.state.isPlaying && !this.state.isPaused && this.state.queue.length > 0) {
      this.playCurrentQueueItem();
    }
  }

  // ==========================================================================
  // STATE GETTERS
  // ==========================================================================

  getState(): TTSState {
    return { ...this.state };
  }

  isPlaying(): boolean {
    return this.state.isPlaying && !this.state.isPaused;
  }

  isPaused(): boolean {
    return this.state.isPaused;
  }

  getCurrentPage(): number {
    return this.state.currentPage;
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Cleanup resources when unmounting.
   */
  async destroy(): Promise<void> {
    // Clear callbacks FIRST (synchronously) to avoid race conditions with
    // React StrictMode double-invocation where a new initialize() may set
    // callbacks between our await calls.
    this.callbacks = {};
    this.silentAudio = null;
    await this.stop();
    console.log('[TTS] Engine destroyed');
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const ttsEngine = new TTSEngine();

export default ttsEngine;
