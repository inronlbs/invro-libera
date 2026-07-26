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
    <div className="max-w-[760px] w-full mx-auto p-4 sm:p-6 lg:p-8 pb-16">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mb-1">Settings</h2>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">Manage your reader preferences, cloud library sync, and software updates.</p>
      </div>

      <div className="flex flex-col gap-6">
        {/* ═══ CLOUD & LIBRARY SYNC ═══ */}
        <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/70 shadow-xs transition-all">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="size-8 rounded-lg bg-indigo-50 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-[20px]">cloud_sync</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Library & Cloud Sync</h3>
              <p className="text-xs text-slate-500">Import .invronpack packages or sync from GitHub Cloud</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* Sync Library Row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
              <div>
                <p className="text-xs font-bold text-slate-800">GitHub Cloud Feed</p>
                <p className="text-[11px] text-slate-500 font-mono">inronlbs/invro-libera-books</p>
              </div>
              <button
                type="button"
                onClick={handleCloudSync}
                disabled={isSyncing}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg text-xs font-bold shadow-xs transition disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[16px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                {isSyncing ? 'Syncing...' : 'Sync Catalog'}
              </button>
            </div>

            {/* Sync Progress Bar */}
            {isSyncing && (
              <div className="space-y-1.5 px-1">
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>{syncPhase || 'Preparing...'}</span>
                  {downloadProgress && downloadProgress.total > 0 && (
                    <span className="font-mono text-slate-500">
                      {(downloadProgress.downloaded / (1024 * 1024)).toFixed(1)} / {(downloadProgress.total / (1024 * 1024)).toFixed(1)} MB ({downloadProgress.percent}%)
                    </span>
                  )}
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress?.percent ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            {syncResult && (
              <div className={`p-3 rounded-lg border text-xs ${
                syncResult.status === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : syncResult.status === 'updated'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-100 border-slate-200 text-slate-800'
              }`}>
                <p className="font-semibold">{syncResult.message}</p>
              </div>
            )}

            {/* Import Package File Row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
              <div>
                <p className="text-xs font-bold text-slate-800">Local Book Package (.invronpack)</p>
                <p className="text-[11px] text-slate-500">Import encrypted books directly into your library</p>
              </div>
              <button
                type="button"
                onClick={handleImportPack}
                disabled={isImporting}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold shadow-xs transition disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">upload_file</span>
                {isImporting ? 'Importing...' : 'Import Package'}
              </button>
            </div>

            {importMessage && (
              <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                {importMessage}
              </p>
            )}
          </div>
        </section>

        {/* ═══ APPLICATION UPDATES ═══ */}
        <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/70 shadow-xs transition-all">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="size-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0">
              <span className="material-symbols-outlined text-[20px]">system_update</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Software Updates</h3>
              <p className="text-xs text-slate-500">v1.4.1 • Standalone Desktop Application</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-slate-50/70 rounded-xl border border-slate-100">
            <div>
              <p className="text-xs font-bold text-slate-800">Check GitHub Releases</p>
              <p className="text-[11px] text-slate-500">Verify if a newer software version is published</p>
            </div>
            <button
              type="button"
              onClick={handleCheckAppUpdate}
              disabled={isCheckingAppUpdate || isInstallingAppUpdate}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold shadow-xs transition disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[16px] ${isCheckingAppUpdate ? 'animate-spin' : ''}`}>update</span>
              {isCheckingAppUpdate ? 'Checking...' : 'Check Updates'}
            </button>
          </div>

          {appUpdateInfo && (
            <div className="mt-3 p-3.5 rounded-xl border border-slate-200 bg-white space-y-2.5 text-xs">
              {appUpdateInfo.available ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-slate-900 text-sm">Update Available: {appUpdateInfo.version}</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] uppercase">New</span>
                  </div>
                  <p className="text-slate-600 text-xs">{appUpdateInfo.notes}</p>
                  <button
                    type="button"
                    onClick={handleInstallAppUpdate}
                    disabled={isInstallingAppUpdate}
                    className="w-full py-2 bg-primary hover:bg-primary/90 text-white font-bold rounded-lg text-xs shadow-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${isInstallingAppUpdate ? 'animate-spin' : ''}`}>download</span>
                    {isInstallingAppUpdate ? 'Installing Patch...' : `Update to ${appUpdateInfo.version}`}
                  </button>
                </div>
              ) : appUpdateInfo.error ? (
                <p className="font-medium text-amber-700">{appUpdateInfo.error}</p>
              ) : (
                <p className="font-medium text-emerald-700">{appUpdateInfo.notes || 'Your application (v1.4.1) is fully up to date!'}</p>
              )}

              {isInstallingAppUpdate && appUpdateProgress && (
                <div className="space-y-1 pt-2 border-t border-slate-100">
                  <div className="flex justify-between text-[10px] font-mono text-slate-500">
                    <span>Downloading update...</span>
                    <span>{appUpdateProgress.percent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${appUpdateProgress.percent}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ═══ READER & TYPOGRAPHY ═══ */}
        <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/70 shadow-xs transition-all">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="size-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
              <span className="material-symbols-outlined text-[20px]">format_size</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Reader Appearance</h3>
              <p className="text-xs text-slate-500">Customize font family and default font size</p>
            </div>
          </div>

          {/* Text Size */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-700 mb-2">Default Font Size</label>
            <div className="grid grid-cols-4 gap-2">
              {(['small', 'medium', 'large', 'xl'] as const).map(size => (
                <button
                  key={size}
                  onClick={() => updateSetting('textSize', size)}
                  className={`py-2 rounded-xl border text-center transition ${
                    settings.textSize === size
                      ? 'border-primary bg-primary/10 text-primary font-bold shadow-2xs'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-xs">
                    {size.charAt(0).toUpperCase() + size.slice(1)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Font Family */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">Font Family</label>
            <div className="grid grid-cols-3 gap-2">
              {([{ id: 'sans', label: 'Sans-Serif', cls: 'font-sans' }, { id: 'serif', label: 'Serif', cls: 'font-serif' }, { id: 'mono', label: 'Monospace', cls: 'font-mono' }] as const).map(f => (
                <button
                  key={f.id}
                  onClick={() => updateSetting('fontFamily', f.id)}
                  className={`flex flex-col items-center justify-center py-2.5 rounded-xl border transition ${
                    settings.fontFamily === f.id
                      ? 'border-primary bg-primary/10 text-primary font-bold shadow-2xs'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className={`text-base ${f.cls}`}>Aa</span>
                  <span className="text-[11px] font-medium">{f.label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ TTS & READ-ALOUD ═══ */}
        <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/70 shadow-xs transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="size-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
                <span className="material-symbols-outlined text-[20px]">volume_up</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">TTS & Read-Aloud</h3>
                <p className="text-xs text-slate-500">Read books aloud with speech engine</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => updateSetting('ttsEnabled', !settings.ttsEnabled)}
              className={`relative w-12 h-6 rounded-full transition-colors ${settings.ttsEnabled ? 'bg-primary' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 size-5 bg-white rounded-full shadow transition-transform ${settings.ttsEnabled ? 'left-6.5' : 'left-0.5'}`} />
            </button>
          </div>

          {settings.ttsEnabled && (
            <div className="mt-4 pt-3 border-t border-slate-100 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Voice Engine</label>
                <select
                  value={settings.ttsVoice}
                  onChange={(e) => updateSetting('ttsVoice', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-medium text-slate-800"
                >
                  <option value="">System Default</option>
                  {availableVoices.map(voice => (
                    <option key={voice.name} value={voice.name}>{voice.name.replace('Microsoft ', '').replace(' Desktop', '')} ({voice.lang})</option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={testTTS}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition shadow-2xs"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                Test Voice
              </button>
            </div>
          )}
        </section>

        {/* ═══ ABOUT FOOTER ═══ */}
        <div className="text-center pt-4 text-xs text-slate-400">
          <p className="font-semibold text-slate-500">Invro Libera Standalone v1.4.1</p>
          <p>© 2026 Invron Labs • All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
