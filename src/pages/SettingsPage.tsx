/**
 * Invro Libera - Standalone Settings Page
 * Features:
 * - Invro Key License Activation & Hardware Fingerprint
 * - .invronpack Book Package Importing
 * - Cloud Library Sync (GitHub Releases Feed)
 * - Appearance & Text Customization
 * - TTS & AI Voice Settings
 * - About Section
 */

import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getSettings, updateSettings as dbUpdateSettings } from '../db';
import { performAutoUpdate, type SyncSummary } from '../services/githubPackSync';
import { isTauriEnvironment } from '../services/localAuth';

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

interface LicenseStatus {
  is_valid: boolean;
  school_name?: string;
  machine_guid: string;
  expiry_date?: string;
  days_remaining?: number;
  message: string;
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

  // License state
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [licenseInput, setLicenseInput] = useState('');
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [isActivating, setIsActivating] = useState(false);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Cloud Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);

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

        // Load License Status if in Tauri
        if (isTauriEnvironment()) {
          try {
            const status = await invoke<LicenseStatus>('get_license_status');
            setLicenseStatus(status);
          } catch (e) {
            console.warn('[License] Failed to fetch status:', e);
          }
        }
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

  const handleActivateLicense = async () => {
    if (!licenseInput.trim()) return;
    setIsActivating(true);
    setLicenseError(null);
    try {
      const result = await invoke<LicenseStatus>('verify_standalone_license', { licenseKey: licenseInput.trim() });
      setLicenseStatus(result);
      if (!result.is_valid) {
        setLicenseError(result.message);
      } else {
        setLicenseInput('');
      }
    } catch (e: any) {
      setLicenseError(e.toString() || 'Failed to activate license key.');
    } finally {
      setIsActivating(false);
    }
  };

  const handleImportPack = async () => {
    if (!isTauriEnvironment()) {
      alert('Package importing requires the Invro Libera desktop app.');
      return;
    }
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Invron Package', extensions: ['invronpack'] }]
      });
      if (selected && typeof selected === 'string') {
        setIsImporting(true);
        setImportMessage(null);
        const imported = await invoke<{ id: string; title: string }[]>('import_invronpack', { filePath: selected });
        setImportMessage(`Successfully imported ${imported.length} book(s) from package!`);
      }
    } catch (e: any) {
      console.error('[Import] Package import failed:', e);
      setImportMessage(`Import error: ${e.toString()}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleCloudSync = async () => {
    setIsSyncing(true);
    setSyncSummary(null);
    try {
      const summary = await performAutoUpdate();
      setSyncSummary(summary);
    } catch (e) {
      console.error('[CloudSync] Error syncing library:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  const testTTS = () => {
    const testText = 'Hello! Welcome to Invro Libera offline reader.';
    const utterance = new SpeechSynthesisUtterance(testText);
    utterance.rate = settings.ttsSpeed;
    utterance.pitch = settings.ttsPitch;
    const voice = availableVoices.find(v => v.name === settings.ttsVoice);
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  };

  return (
    <div className="max-w-[800px] w-full mx-auto p-4 sm:p-6 lg:p-8 pb-12">
      <h2 className="text-3xl font-black tracking-tight text-slate-900 mb-8 px-2">Settings</h2>

      {/* ═══ LICENSE & ACTIVATION ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">vpn_key</span>
          Invro Key Activation
        </h3>

        <div className="space-y-4">
          {/* Machine Fingerprint */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Device Hardware Fingerprint</p>
              <p className="text-sm font-mono font-bold text-slate-800">{licenseStatus?.machine_guid || 'Loading fingerprint...'}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (licenseStatus?.machine_guid) {
                  navigator.clipboard.writeText(licenseStatus.machine_guid);
                  alert('Hardware Fingerprint copied to clipboard!');
                }
              }}
              className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs"
            >
              Copy
            </button>
          </div>

          {/* License Status Badge */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50">
            <div>
              <p className="text-xs font-semibold text-slate-500">License Status</p>
              <p className="text-base font-extrabold text-slate-900">
                {licenseStatus?.is_valid ? (licenseStatus.school_name || 'Active License') : 'Unlicensed / Free Mode'}
              </p>
              {licenseStatus?.expiry_date && (
                <p className="text-xs text-slate-500 mt-0.5">Expires: {licenseStatus.expiry_date}</p>
              )}
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold ${
              licenseStatus?.is_valid 
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                : 'bg-amber-100 text-amber-800 border border-amber-300'
            }`}>
              {licenseStatus?.is_valid ? 'VALID LICENSE' : 'DEMO MODE'}
            </span>
          </div>

          {/* Key Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Enter Invro License Key</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={licenseInput}
                onChange={(e) => setLicenseInput(e.target.value)}
                placeholder="Paste your Invro Key JSON or Activation Token..."
                className="flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              <button
                type="button"
                onClick={handleActivateLicense}
                disabled={isActivating || !licenseInput.trim()}
                className="px-5 py-2.5 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary/90 disabled:opacity-50 transition shadow-sm"
              >
                {isActivating ? 'Activating...' : 'Activate Key'}
              </button>
            </div>
            {licenseError && (
              <p className="text-xs font-medium text-red-600 mt-1.5">{licenseError}</p>
            )}
          </div>
        </div>
      </section>

      {/* ═══ IMPORT BOOK PACKAGES (.invronpack) ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">archive</span>
          Import Book Packages (.invronpack)
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Import offline encrypted book packages exported from Invron Dev Studio directly into your local library database.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">Select Package File</p>
            <p className="text-xs text-slate-500">Supports .invronpack files containing encrypted PDFs & EPUBs</p>
          </div>
          <button
            type="button"
            onClick={handleImportPack}
            disabled={isImporting}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">upload_file</span>
            {isImporting ? 'Importing...' : 'Import .invronpack'}
          </button>
        </div>

        {importMessage && (
          <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3 mt-3">
            {importMessage}
          </p>
        )}
      </section>

      {/* ═══ CLOUD LIBRARY SYNC ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">cloud_sync</span>
          Cloud Library Sync
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Sync your book catalog and download missing content directly from the official Invro Libera cloud repository on GitHub.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">Official Catalog Feed</p>
            <p className="text-xs text-slate-500 font-mono">inronlbs/invro-libera-books</p>
          </div>
          <button
            type="button"
            onClick={handleCloudSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
            {isSyncing ? 'Syncing Catalog...' : 'Sync Library Now'}
          </button>
        </div>

        {syncSummary && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 mt-3 space-y-1">
            <p className="font-bold">Sync Completed!</p>
            <p>New Books Added: {syncSummary.added} | Books Updated: {syncSummary.updated} | Skipped: {syncSummary.skipped}</p>
          </div>
        )}
      </section>

      {/* ═══ APPEARANCE ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-5 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">palette</span>
          Appearance & Reader Typography
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
            <p className="font-medium text-sm text-slate-900">Enable AI Voice Read-Aloud</p>
            <p className="text-xs text-slate-500">Read books aloud using natural neural voice engines</p>
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
            <div className="py-3 border-b border-slate-100">
              <label className="block text-xs font-medium text-slate-700 mb-2">Voice</label>
              <select
                value={settings.ttsVoice}
                onChange={(e) => updateSetting('ttsVoice', e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-700"
              >
                <option value="">Auto (System Default)</option>
                {availableVoices.map(voice => (
                  <option key={voice.name} value={voice.name}>{voice.name.replace('Microsoft ', '').replace(' Desktop', '')} ({voice.lang})</option>
                ))}
              </select>
            </div>

            <div className="pt-4">
              <button onClick={testTTS} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/90 transition shadow-sm">
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
          About Invro Libera
        </h3>

        <div className="space-y-4">
          <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <img src="/favicon.png" alt="Invro Libera" className="h-12 w-12 object-contain" />
            <div>
              <p className="font-extrabold text-slate-900">Invro Libera Standalone</p>
              <p className="text-xs text-slate-500">v1.0.2 • Offline E-Library & Encrypted Book Reader</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 pt-2">
            Built by Invron Labs • © 2026 All rights reserved.
          </p>
        </div>
      </section>
    </div>
  );
}
