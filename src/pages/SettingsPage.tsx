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

import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { getSettings, updateSettings as dbUpdateSettings } from '../db';
import { performAutoUpdate, type CloudSyncResult } from '../services/githubPackSync';
import { checkAppUpdate, downloadAndInstallAppUpdate, type AppUpdateInfo } from '../services/appUpdateService';
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

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  // Cloud Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CloudSyncResult | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number; percent: number } | null>(null);
  const [syncPhase, setSyncPhase] = useState<string>('');
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // App Software Update state
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [isCheckingAppUpdate, setIsCheckingAppUpdate] = useState(false);
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false);
  const [appUpdateProgress, setAppUpdateProgress] = useState<{ downloaded: number; total: number; percent: number } | null>(null);

  const handleCheckAppUpdate = async () => {
    setIsCheckingAppUpdate(true);
    setAppUpdateInfo(null);
    try {
      const info = await checkAppUpdate();
      setAppUpdateInfo(info);
    } finally {
      setIsCheckingAppUpdate(false);
    }
  };

  const handleInstallAppUpdate = async () => {
    if (!appUpdateInfo?.updateObj) return;
    setIsInstallingAppUpdate(true);
    setAppUpdateProgress(null);
    try {
      await downloadAndInstallAppUpdate(appUpdateInfo.updateObj, (downloaded, total) => {
        const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
        setAppUpdateProgress({ downloaded, total, percent });
      });
    } catch (err: any) {
      setAppUpdateInfo({
        available: false,
        error: `Installation failed: ${err?.message || err?.toString()}`
      });
    } finally {
      setIsInstallingAppUpdate(false);
    }
  };

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
    setSyncResult(null);
    setDownloadProgress(null);
    setSyncPhase('Checking for updates...');

    // Listen for download progress events from Rust
    try {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      unlistenRef.current = await listen<{ downloaded: number; total: number; percent: number }>('cloud-download-progress', (event) => {
        setDownloadProgress(event.payload);
        if (event.payload.percent < 100) {
          setSyncPhase('Downloading book pack...');
        } else {
          setSyncPhase('Importing books...');
        }
      });
    } catch {
      // listen may fail outside Tauri, ignore
    }

    try {
      const result = await performAutoUpdate();
      setSyncResult(result);
      setDownloadProgress(null);
      setSyncPhase('');
    } catch (e: any) {
      console.error('[CloudSync] Error syncing library:', e);
      setSyncResult({
        success: false,
        status: 'error',
        message: `Sync Error: ${e.message || e.toString()}`
      });
      setDownloadProgress(null);
      setSyncPhase('');
    } finally {
      setIsSyncing(false);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
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

        {/* Download Progress Bar */}
        {isSyncing && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium">{syncPhase || 'Preparing...'}</span>
              {downloadProgress && downloadProgress.total > 0 && (
                <span className="font-mono text-slate-500">
                  {(downloadProgress.downloaded / (1024 * 1024)).toFixed(1)} / {(downloadProgress.total / (1024 * 1024)).toFixed(1)} MB
                  <span className="ml-2 font-bold text-primary">{downloadProgress.percent}%</span>
                </span>
              )}
            </div>
            <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/70 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${downloadProgress?.percent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {syncResult && (
          <div className={`p-3.5 rounded-xl border text-xs mt-3.5 space-y-1 ${
            syncResult.status === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : syncResult.status === 'updated'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}>
            <p className="font-bold">{syncResult.message}</p>
            {syncResult.summary && (syncResult.summary.added > 0 || syncResult.summary.updated > 0) && (
              <p className="text-[11px] opacity-80">Added: {syncResult.summary.added} | Updated: {syncResult.summary.updated} | Skipped: {syncResult.summary.skipped}</p>
            )}
          </div>
        )}
      </section>

      {/* ═══ APPLICATION SOFTWARE UPDATES ═══ */}
      <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">system_update</span>
          App Software Updates
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Keep Invro Libera Standalone up to date with the latest desktop software releases, security patches, and features directly from GitHub.
        </p>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <p className="text-sm font-bold text-slate-800">Installed Application Version</p>
            <p className="text-xs text-slate-500 font-mono">v0.1.0 (Standalone Desktop Build)</p>
          </div>
          <button
            type="button"
            onClick={handleCheckAppUpdate}
            disabled={isCheckingAppUpdate || isInstallingAppUpdate}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-sm transition disabled:opacity-50"
          >
            <span className={`material-symbols-outlined text-[18px] ${isCheckingAppUpdate ? 'animate-spin' : ''}`}>update</span>
            {isCheckingAppUpdate ? 'Checking Updates...' : 'Check for App Updates'}
          </button>
        </div>

        {appUpdateInfo && (
          <div className="mt-4 p-4 rounded-xl border border-slate-200 bg-white space-y-3 text-xs">
            {appUpdateInfo.available ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-900 text-sm">New Version Available: {appUpdateInfo.version}</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">Ready</span>
                </div>
                <p className="text-slate-600 leading-relaxed">{appUpdateInfo.notes}</p>
                <button
                  type="button"
                  onClick={handleInstallAppUpdate}
                  disabled={isInstallingAppUpdate}
                  className="w-full py-2.5 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl text-xs shadow-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span className={`material-symbols-outlined text-[18px] ${isInstallingAppUpdate ? 'animate-spin' : ''}`}>download</span>
                  {isInstallingAppUpdate ? 'Downloading & Restarting Application...' : `Update Now to ${appUpdateInfo.version}`}
                </button>
              </div>
            ) : appUpdateInfo.error ? (
              <p className="font-medium text-amber-700">{appUpdateInfo.error}</p>
            ) : (
              <p className="font-semibold text-emerald-700">{appUpdateInfo.notes || 'Your application (v0.1.0) is fully up to date!'}</p>
            )}

            {isInstallingAppUpdate && appUpdateProgress && (
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <div className="flex justify-between text-[11px] font-mono text-slate-600">
                  <span>Downloading application patch...</span>
                  <span>{(appUpdateProgress.downloaded / (1024 * 1024)).toFixed(1)} / {(appUpdateProgress.total / (1024 * 1024)).toFixed(1)} MB ({appUpdateProgress.percent}%)</span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${appUpdateProgress.percent}%` }} />
                </div>
              </div>
            )}
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
