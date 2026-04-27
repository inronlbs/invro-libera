/**
 * Invro Libera - Client Settings Page
 * Simple single-page layout with Appearance, Audio & TTS, and About sections.
 * This is for the student/client browser — no host features here.
 */

import { useState, useEffect } from 'react';
import { getSettings, updateSettings as dbUpdateSettings } from '../db';

// ============================================================================
// TYPES
// ============================================================================

interface SettingsState {
  textSize: 'small' | 'medium' | 'large' | 'xl';
  fontFamily: 'sans' | 'serif' | 'mono';
  lineSpacing: 'compact' | 'normal' | 'relaxed';
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsSpeed: number;
  ttsPitch: number;
  autoPlay: boolean;
  highlightText: boolean;
}

const DEFAULT_SETTINGS: SettingsState = {
  textSize: 'medium',
  fontFamily: 'sans',
  lineSpacing: 'normal',
  ttsEnabled: true,
  ttsVoice: '',
  ttsSpeed: 1,
  ttsPitch: 1,
  autoPlay: false,
  highlightText: true,
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    const loadAll = async () => {
      try {
        const dbSettings = await getSettings();
        const local = localStorage.getItem('invro-libera-settings');
        const localParsed = local ? JSON.parse(local) : {};

        setSettings({
          ...DEFAULT_SETTINGS,
          textSize: localParsed.textSize ?? DEFAULT_SETTINGS.textSize,
          fontFamily: localParsed.fontFamily ?? DEFAULT_SETTINGS.fontFamily,
          lineSpacing: localParsed.lineSpacing ?? DEFAULT_SETTINGS.lineSpacing,
          autoPlay: localParsed.autoPlay ?? DEFAULT_SETTINGS.autoPlay,
          highlightText: localParsed.highlightText ?? DEFAULT_SETTINGS.highlightText,
          ttsEnabled: localParsed.ttsEnabled ?? DEFAULT_SETTINGS.ttsEnabled,
          ttsVoice: dbSettings.ttsVoice ?? '',
          ttsSpeed: dbSettings.ttsRate ?? 1,
          ttsPitch: localParsed.ttsPitch ?? 1,
        });
      } catch (e) {
        console.error('[Settings] Failed to load settings:', e);
      }
    };
    loadAll();

    // TTS voices
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setAvailableVoices(voices);
      if (voices.length > 0) {
        setSettings(prev => {
          if (prev.ttsVoice) return prev;
          const next = { ...prev, ttsVoice: voices[0].name };
          localStorage.setItem('invro-libera-settings', JSON.stringify(next));
          dbUpdateSettings({ ttsVoice: voices[0].name }).catch(console.error);
          return next;
        });
      }
    };
    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    localStorage.setItem('invro-libera-settings', JSON.stringify(newSettings));

    const dbKeys: Record<string, string> = {
      ttsVoice: 'ttsVoice',
      ttsSpeed: 'ttsRate',
    };
    if (key in dbKeys) {
      dbUpdateSettings({ [dbKeys[key as string]]: value }).catch(console.error);
    }
  };

  const testTTS = async () => {
    const testText = 'Hello! This is a test of the text to speech system.';
    const utterance = new SpeechSynthesisUtterance(testText);
    utterance.rate = settings.ttsSpeed;
    utterance.pitch = settings.ttsPitch;
    const voice = availableVoices.find(v => v.name === settings.ttsVoice);
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  };

  return (
    <div className="max-w-[800px] w-full mx-auto p-4 sm:p-6 lg:p-8 pb-8">
      <h2 className="text-3xl font-black tracking-tight text-slate-900 mb-8 px-2">Settings</h2>

      {/* ═══ APPEARANCE ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">palette</span>
          Appearance
        </h3>

        {/* Text Size */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-2">Text Size</label>
          <div className="grid grid-cols-4 gap-2">
            {(['small', 'medium', 'large', 'xl'] as const).map(size => (
              <button
                key={size}
                onClick={() => updateSetting('textSize', size)}
                className={`py-2.5 rounded-xl border-2 text-center transition ${
                  settings.textSize === size
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <span className={`font-medium ${size === 'small' ? 'text-xs' : size === 'medium' ? 'text-sm' : size === 'large' ? 'text-base' : 'text-lg'}`}>
                  {size.charAt(0).toUpperCase() + size.slice(1)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Font Family */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-700 mb-2">Font Family</label>
          <div className="grid grid-cols-3 gap-2">
            {([{ id: 'sans', label: 'Sans', cls: 'font-sans' }, { id: 'serif', label: 'Serif', cls: 'font-serif' }, { id: 'mono', label: 'Mono', cls: 'font-mono' }] as const).map(f => (
              <button
                key={f.id}
                onClick={() => updateSetting('fontFamily', f.id)}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition ${
                  settings.fontFamily === f.id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <span className={`text-xl font-bold ${f.cls}`}>Aa</span>
                <span className="text-xs font-medium">{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Line Spacing */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Line Spacing</label>
          <div className="grid grid-cols-3 gap-2">
            {([{ id: 'compact', label: 'Compact', icon: 'density_small' }, { id: 'normal', label: 'Normal', icon: 'density_medium' }, { id: 'relaxed', label: 'Relaxed', icon: 'density_large' }] as const).map(s => (
              <button
                key={s.id}
                onClick={() => updateSetting('lineSpacing', s.id)}
                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition ${
                  settings.lineSpacing === s.id
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">{s.icon}</span>
                <span className="text-xs font-medium">{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ AUDIO & TTS ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">record_voice_over</span>
          TTS & AI Voice
        </h3>

        {/* TTS Toggle */}
        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div>
            <p className="font-medium text-sm text-slate-900">Enable AI Voice</p>
            <p className="text-xs text-slate-500">Read books aloud (English only)</p>
          </div>
          <button
            onClick={() => updateSetting('ttsEnabled', !settings.ttsEnabled)}
            className={`relative w-14 h-8 rounded-full transition-colors ${settings.ttsEnabled ? 'bg-primary' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-1 size-6 bg-white rounded-full shadow transition-transform ${settings.ttsEnabled ? 'left-7' : 'left-1'}`}></span>
          </button>
        </div>

        {settings.ttsEnabled && (
          <>
            {/* Voice Selection */}
            <div className="py-3 border-b border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-2">Voice</label>
              <div className="relative mt-2">
                <select
                  value={settings.ttsVoice}
                  onChange={(e) => updateSetting('ttsVoice', e.target.value)}
                  className="w-full appearance-none bg-white border border-slate-200 hover:border-slate-300 rounded-xl px-4 py-3 text-[13.5px] font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all cursor-pointer shadow-sm"
                >
                  <option value="">Auto (System Default)</option>
                  {availableVoices.map(voice => (
                    <option key={voice.name} value={voice.name}>{voice.name.replace('Microsoft ', '').replace(' Desktop', '')} ({voice.lang})</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <span className="material-symbols-outlined text-[20px]">expand_more</span>
                </div>
              </div>
            </div>

            {/* Speed */}
            <div className="py-3 border-b border-slate-100">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-slate-700">Speed</label>
                <span className="text-sm text-primary font-medium">{settings.ttsSpeed.toFixed(1)}x</span>
              </div>
              <input type="range" min="0.5" max="2" step="0.1" value={settings.ttsSpeed} onChange={e => updateSetting('ttsSpeed', parseFloat(e.target.value))} className="w-full accent-primary" />
              <div className="flex justify-between text-xs text-slate-400 mt-1"><span>0.5x</span><span>2x</span></div>
            </div>

            {/* Highlight Text */}
            <div className="flex items-center justify-between py-3 border-b border-slate-100">
              <div>
                <p className="font-medium text-sm text-slate-900">Highlight Text</p>
                <p className="text-xs text-slate-500">Highlight words as they're spoken</p>
              </div>
              <button
                onClick={() => updateSetting('highlightText', !settings.highlightText)}
                className={`relative w-14 h-8 rounded-full transition-colors ${settings.highlightText ? 'bg-primary' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 size-6 bg-white rounded-full shadow transition-transform ${settings.highlightText ? 'left-7' : 'left-1'}`}></span>
              </button>
            </div>

            {/* Auto-play */}
            <div className="flex items-center justify-between py-3 border-b border-slate-100">
              <div>
                <p className="font-medium text-sm text-slate-900">Auto-Play Next</p>
                <p className="text-xs text-slate-500">Continue to the next chapter automatically</p>
              </div>
              <button
                onClick={() => updateSetting('autoPlay', !settings.autoPlay)}
                className={`relative w-14 h-8 rounded-full transition-colors ${settings.autoPlay ? 'bg-primary' : 'bg-slate-300'}`}
              >
                <span className={`absolute top-1 size-6 bg-white rounded-full shadow transition-transform ${settings.autoPlay ? 'left-7' : 'left-1'}`}></span>
              </button>
            </div>

            {/* Test Button */}
            <div className="pt-4">
              <button onClick={testTTS} className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition">
                <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                Test Voice
              </button>
            </div>
          </>
        )}
      </section>

      {/* ═══ ABOUT ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">info</span>
          About
        </h3>

        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
            <img src="/favicon.png" alt="Invro Libera" className="h-12 w-12 object-contain" />
            <div>
              <p className="font-bold text-slate-900">Invro Libera</p>
              <p className="text-sm text-slate-500">v1.0.0 • Offline E-Library</p>
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-slate-100">
            <span className="text-sm text-slate-700">Platform</span>
            <span className="text-sm font-semibold text-slate-900">Chrome Client</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-slate-100">
            <span className="text-sm text-slate-700">Data Sync</span>
            <span className="text-sm font-semibold text-slate-900">Auto (from Host)</span>
          </div>

          <p className="text-xs text-slate-400 pt-2">
            Built by Invron Labs • © 2026 All rights reserved.
          </p>
        </div>
      </section>
    </div>
  );
}
