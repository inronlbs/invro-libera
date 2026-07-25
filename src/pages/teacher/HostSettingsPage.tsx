/**
 * Invro Libera - Host Settings Page
 * Tabbed card-based navigation for host-oriented settings.
 * Only used inside the Teacher/Admin panel (Tauri desktop app).
 */

import { useState, useEffect } from 'react';
import db, { getSettings, updateSettings as dbUpdateSettings } from '../../db';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

// ============================================================================
// TYPES
// ============================================================================

type TabId = 'main' | 'school' | 'import' | 'data' | 'server' | 'about' | 'audit';

interface AuditLogEntry {
  timestamp: string;
  action: string;
  details: string;
}

interface LicenseInfo {
  key?: string;
  school?: string;
  lab?: string;
  device?: string;
  expiresAt?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function HostSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('main');

  // Server Info
  const [localIp, setLocalIp] = useState('127.0.0.1');
  const [naturalVoiceStatus, setNaturalVoiceStatus] = useState<'checking' | 'not_installed' | 'installed_hidden' | 'unlocked' | 'not_windows'>('not_windows');

  // License Info
  const [licenseData, setLicenseData] = useState<LicenseInfo | null>(null);

  // School Details
  const [schoolName, setSchoolName] = useState('');
  const [labDetails, setLabDetails] = useState('');
  const [labIncharge, setLabIncharge] = useState('');
  const [isSavingSchool, setIsSavingSchool] = useState(false);

  // Import Pack
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ added: number; updated: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditFilter, setAuditFilter] = useState('ALL');

  // Clear Data
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [clearType, setClearType] = useState<'roster' | 'catalog' | 'license' | 'all' | null>(null);
  const [clearConfirmText, setClearConfirmText] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const dbSettings = await getSettings();
        
        if (dbSettings.licenseKey) {
          setLicenseData({
            key: dbSettings.licenseKey,
            school: dbSettings.licenseSchool,
            lab: dbSettings.licenseLab,
            device: dbSettings.licenseDeviceId,
            expiresAt: dbSettings.licenseExpiresAt,
          });
        }
      } catch (e) {
        console.error('[HostSettings] Failed to load:', e);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (activeTab === 'audit') {
      const fetchLogs = async () => {
        setLogsLoading(true);
        try {
          const logs = await invoke<AuditLogEntry[]>('get_audit_logs');
          setAuditLogs(logs);
        } catch (e) {
          console.error("Failed to load audit logs:", e);
        } finally {
          setLogsLoading(false);
        }
      };
      fetchLogs();
    } else if (activeTab === 'school') {
      const fetchSchoolDetails = async () => {
        try {
          const [name, details, incharge] = await Promise.all([
            invoke<string>('get_school_name'),
            invoke<string>('get_lab_details'),
            invoke<string>('get_lab_incharge'),
          ]);
          setSchoolName(name);
          setLabDetails(details);
          setLabIncharge(incharge);
        } catch (e) {
          console.error("Failed to load school details:", e);
        }
      };
      fetchSchoolDetails();
    } else if (activeTab === 'server') {
      const fetchServerInfo = async () => {
        try {
          const ip = await invoke<string>('get_local_ip');
          if (ip) setLocalIp(ip);
        } catch (e) {
          console.error("Failed to load local IP:", e);
        }
      };
      const checkVoices = async () => {
        try {
          setNaturalVoiceStatus('checking');
          const status = await invoke<'checking' | 'not_installed' | 'installed_hidden' | 'unlocked' | 'not_windows'>('check_natural_voices');
          setNaturalVoiceStatus(status);
        } catch (e) {
          console.error('[HostSettings] natural voices check failed:', e);
          setNaturalVoiceStatus('not_windows');
        }
      };
      fetchServerInfo();
      checkVoices();
    }
  }, [activeTab]);

  // ── School Details handlers ──
  const handleSaveSchoolDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSchool(true);
    try {
      await invoke('set_school_name', { name: schoolName.trim() });
      await invoke('set_lab_details', { details: labDetails.trim() });
      await invoke('set_lab_incharge', { incharge: labIncharge.trim() });
      alert("School & Lab details saved successfully.");
    } catch (error) {
       console.error("Failed to save School Details:", error);
       alert("Failed to save School details.");
    } finally {
      setIsSavingSchool(false);
    }
  };

  // ── Data Management handlers ──
  const handleClearData = async () => {
    if (clearConfirmText !== 'CLEAR') return;
    try {
      if (clearType === 'catalog') {
        await invoke('clear_catalog');
        await db.books.clear();
        await db.downloadChunks.clear();
        alert("Library Catalog wiped successfully.");
      } else if (clearType === 'roster') {
        await invoke('clear_roster');
        await db.userProgress.clear();
        await db.readingNotes.clear();
        alert("Active Roster wiped successfully.");
      } else if (clearType === 'license') {
        const currentSettings = await getSettings();
        const oldKey = currentSettings.licenseKey || 'Unknown';
        await dbUpdateSettings({
          ...currentSettings,
          licenseKey: undefined,
          licenseSchool: undefined,
          licenseLab: undefined,
          licenseDeviceId: undefined,
          licenseExpiresAt: undefined,
        });
        
        try {
          await invoke('log_frontend_event', {
            action: 'LICENSE_DEACTIVATED',
            details: `Manually deactivated license key: ${oldKey}`
          });
        } catch (e) {
          console.warn("Audit log failed:", e);
        }

        alert("License deactivated successfully. The app will lock upon reload.");
      } else if (clearType === 'all') {
        await invoke('clear_catalog');
        await invoke('clear_school_data');
        await db.books.clear();
        await db.userProgress.clear();
        await db.downloadChunks.clear();
        await db.readingNotes.clear();
        await db.settings.clear();
        localStorage.setItem('invro-data-cleared', 'true');
        alert("Factory Reset complete.");
      }

      setIsClearModalOpen(false);
      setClearType(null);
      setClearConfirmText('');
      window.location.reload();
    } catch (e) {
      console.error('Failed to clear data:', e);
      alert('Failed to clear data successfully.');
    }
  };

  // ── Import Pack handler ──
  const handleImportPack = async () => {
    if (isImporting) return;
    
    try {
      const selectedPath = await open({
        multiple: false,
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Invron Pack', extensions: ['invronpack'] }
        ]
      });

      if (!selectedPath) return;

      setIsImporting(true);
      setImportResult(null);
      setImportError(null);
      
      const filePath = Array.isArray(selectedPath) ? selectedPath[0] : selectedPath;
      setImportFileName(filePath.split(/[/\\]/).pop() || 'Pack file');

      // Call the Rust command to natively unzip, decrypt, and save into the server catalog
      const importedBooks = await invoke<{id: string, title: string}[]>('import_invronpack', { filePath });
      
      // Update local Dexie DB so the frontend immediately sees the new books
      const { syncCatalogForUser } = await import('../../services/catalogSync');
      await syncCatalogForUser();

      setImportResult({ added: importedBooks.length, updated: 0, skipped: 0 });

      // Also clear the data-cleared flag since we're importing new data
      localStorage.removeItem('invro-data-cleared');
    } catch (err: unknown) {
      console.error('[Import] Failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(msg || 'Failed to import pack file.');
    } finally {
      setIsImporting(false);
    }
  };

  // ============================================================================
  // RENDER HELPERS
  // ============================================================================

  const renderHeader = (title: string, icon: string) => (
    <div className="flex items-center gap-3 mb-8">
      <button
        onClick={() => setActiveTab('main')}
        className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition-colors"
      >
        <span className="material-symbols-outlined text-[24px]">arrow_back</span>
      </button>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-[24px]">{icon}</span>
        <h2 className="text-2xl font-black tracking-tight text-slate-900">{title}</h2>
      </div>
    </div>
  );

  const renderMainGrid = () => (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h2 className="text-3xl font-black tracking-tight text-slate-900 mb-2 px-2">Host Settings</h2>
      <p className="text-sm text-slate-500 mb-8 px-2">Configure your host system and library.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* School Details */}
        <button
          onClick={() => setActiveTab('school')}
          className="group p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-primary/20 transition-all text-left flex flex-col gap-4"
        >
          <div className="size-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[28px]">apartment</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">School & Lab Details</h3>
            <p className="text-sm text-slate-500 mt-1">Configure school name and site information.</p>
          </div>
        </button>

        {/* Library Sync - Hidden intentionally as requested */}
        {/* <button ...> */}

        {/* Import Pack */}
        <button
          onClick={() => setActiveTab('import')}
          className="group p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-primary/20 transition-all text-left flex flex-col gap-4"
        >
          <div className="size-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[28px]">package_2</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Import Pack</h3>
            <p className="text-sm text-slate-500 mt-1">Manually import an .invronpack file.</p>
          </div>
        </button>

        {/* Data Management */}
        <button
          onClick={() => setActiveTab('data')}
          className="group p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-red-200 transition-all text-left flex flex-col gap-4"
        >
          <div className="size-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center group-hover:bg-red-600 group-hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[28px]">database</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Data Management</h3>
            <p className="text-sm text-slate-500 mt-1">Granular controls to clear local data, cache, and roster.</p>
          </div>
        </button>

        {/* Server Info */}
        <button
          onClick={() => setActiveTab('server')}
          className="group p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-primary/20 transition-all text-left flex flex-col gap-4"
        >
          <div className="size-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[28px]">dns</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Server Info</h3>
            <p className="text-sm text-slate-500 mt-1">Axum server port and network details.</p>
          </div>
        </button>

        {/* About */}
        <button
          onClick={() => setActiveTab('about')}
          className="group p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-primary/20 transition-all text-left flex flex-col gap-4"
        >
          <div className="size-12 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[28px]">info</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">About</h3>
            <p className="text-sm text-slate-500 mt-1">App version and platform info.</p>
          </div>
        </button>

        {/* Server Audit Log */}
        <button
          onClick={() => setActiveTab('audit')}
          className="group p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md hover:border-primary/20 transition-all text-left flex flex-col gap-4"
        >
          <div className="size-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-colors">
            <span className="material-symbols-outlined text-[28px]">history</span>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Audit Logs</h3>
            <p className="text-sm text-slate-500 mt-1">Immutable server activity tracking.</p>
          </div>
        </button>
      </div>
    </div>
  );

  // ============================================================================
  // RETURN
  // ============================================================================

  return (
    <div className={`w-full mx-auto p-4 sm:p-6 lg:p-8 pb-8 flex-1 overflow-y-auto transition-all duration-300 ${activeTab === 'audit' ? 'max-w-6xl' : 'max-w-[800px]'}`}>

      {activeTab === 'main' && renderMainGrid()}

      {/* ═══ SCHOOL DETAILS ═══ */}
      {activeTab === 'school' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {renderHeader('School & Lab Details', 'apartment')}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
            <form onSubmit={handleSaveSchoolDetails} className="space-y-4">
              {licenseData && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-4 flex items-start gap-4 shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined">verified_user</span>
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-emerald-900">Active License</h4>
                    <p className="text-xs text-emerald-700 font-mono mt-1">{licenseData.key}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-emerald-800">
                      <div><span className="opacity-70">Device:</span> {licenseData.device || 'N/A'}</div>
                      <div><span className="opacity-70">Expires:</span> {licenseData.expiresAt}</div>
                    </div>
                  </div>
                </div>
              )}
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">School Name</label>
                <input
                  type="text"
                  required
                  value={licenseData?.school || schoolName}
                  onChange={(e) => !licenseData?.school && setSchoolName(e.target.value)}
                  readOnly={!!licenseData?.school}
                  placeholder="E.g., Springfield Elementary School"
                  className={`w-full border rounded-lg px-4 py-2.5 outline-none transition-all text-sm ${
                    licenseData?.school 
                      ? 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed' 
                      : 'bg-slate-50 text-slate-900 border-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Lab Details / Room Number</label>
                <input
                  type="text"
                  value={licenseData?.lab || labDetails}
                  onChange={(e) => !licenseData?.lab && setLabDetails(e.target.value)}
                  readOnly={!!licenseData?.lab}
                  placeholder="E.g., Computer Lab A - Main Building"
                  className={`w-full border rounded-lg px-4 py-2.5 outline-none transition-all text-sm ${
                    licenseData?.lab 
                      ? 'bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed' 
                      : 'bg-slate-50 text-slate-900 border-slate-300 focus:ring-2 focus:ring-primary/20 focus:border-primary'
                  }`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Lab In-Charge Person</label>
                <input
                  type="text"
                  value={labIncharge}
                  onChange={(e) => setLabIncharge(e.target.value)}
                  placeholder="E.g., Mr. Smith"
                  className="w-full bg-slate-50 border border-slate-300 text-slate-900 rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm"
                />
              </div>
              <div className="pt-4 flex justify-end">
                  <button type="submit" disabled={isSavingSchool} className="px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition disabled:opacity-50">
                    {isSavingSchool ? 'Saving...' : 'Save Details'}
                  </button>
              </div>
            </form>
          </section>
        </div>
      )}


      {/* ═══ IMPORT PACK ═══ */}
      {activeTab === 'import' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {renderHeader('Import Pack', 'package_2')}

          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
            <p className="text-sm text-slate-600 mb-6">
              Select an <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono text-primary">.invronpack</code> file exported from the Invron Dev Studio. The pack will be decrypted and imported into the host library.
            </p>

            {/* File picker area */}
            <div
              onClick={handleImportPack}
              className={`flex flex-col items-center justify-center gap-3 p-10 rounded-2xl border-2 border-dashed transition-all ${
                isImporting
                  ? 'border-primary/30 bg-primary/5 cursor-wait'
                  : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50 cursor-pointer'
              }`}
            >
              {isImporting ? (
                <>
                  <span className="material-symbols-outlined text-[48px] text-primary animate-spin">progress_activity</span>
                  <span className="text-sm font-semibold text-primary">Importing {importFileName}...</span>
                  <span className="text-xs text-slate-400">Decrypting and processing books...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[48px] text-slate-300">upload_file</span>
                  <span className="text-sm font-semibold text-slate-700">Click to select .invronpack file</span>
                  <span className="text-xs text-slate-400">Supports AES-256 encrypted pack archives</span>
                </>
              )}
            </div>

            {/* Success result */}
            {importResult && (
              <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                <span className="material-symbols-outlined text-emerald-600 text-[24px] mt-0.5">check_circle</span>
                <div>
                  <p className="text-sm font-bold text-emerald-900">Import Successful!</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    {importResult.added} books added, {importResult.updated} updated, {importResult.skipped} skipped.
                  </p>
                  {importFileName && (
                    <p className="text-xs text-emerald-600 mt-0.5 font-mono">{importFileName}</p>
                  )}
                </div>
              </div>
            )}

            {/* Error result */}
            {importError && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                <span className="material-symbols-outlined text-red-600 text-[24px] mt-0.5">error</span>
                <div>
                  <p className="text-sm font-bold text-red-900">Import Failed</p>
                  <p className="text-xs text-red-700 mt-1">{importError}</p>
                </div>
              </div>
            )}
          </section>

          <section className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">How it works</h4>
            <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
              <li>Use the <strong>Invron Dev Studio</strong> to package raw PDFs/EPUBs into an encrypted <code className="bg-white px-1 rounded font-mono">.invronpack</code></li>
              <li>Transfer the pack file to this host PC via USB, network share, or download</li>
              <li>Select the pack file above — books will be decrypted and added to the library</li>
              <li>Connected client devices will see the new books on their next sync</li>
            </ol>
          </section>
        </div>
      )}

      {/* ═══ DATA MANAGEMENT ═══ */}
      {activeTab === 'data' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {renderHeader('Data Management', 'database')}
          
          <div className="grid grid-cols-1 gap-4 mb-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Wipe Active Roster</h3>
                    <p className="text-sm text-slate-500">Deletes all students, classes, and resets active reading sessions.</p>
                </div>
                <button 
                  onClick={() => { setClearType('roster'); setIsClearModalOpen(true); }} 
                  className="px-6 py-2.5 whitespace-nowrap bg-amber-50 text-amber-700 font-bold rounded-xl hover:bg-amber-100 border border-amber-200 transition"
                >
                  Wipe Roster
                </button>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Wipe Library Catalog</h3>
                    <p className="text-sm text-slate-500">Deletes all book metadata and encrypted server-side book files.</p>
                </div>
                <button 
                  onClick={() => { setClearType('catalog'); setIsClearModalOpen(true); }} 
                  className="px-6 py-2.5 whitespace-nowrap bg-orange-50 text-orange-700 font-bold rounded-xl hover:bg-orange-100 border border-orange-200 transition"
                >
                  Wipe Catalog
                </button>
            </div>

            {licenseData && (
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                      <h3 className="text-lg font-bold text-slate-800 mb-1">Deactivate License</h3>
                      <p className="text-sm text-slate-500">Removes the current activation key for this device.</p>
                  </div>
                  <button 
                    onClick={() => { setClearType('license'); setIsClearModalOpen(true); }} 
                    className="px-6 py-2.5 whitespace-nowrap bg-slate-100 text-slate-700 font-bold rounded-xl hover:bg-slate-200 border border-slate-300 transition"
                  >
                    Deactivate
                  </button>
              </div>
            )}

            <div className="bg-red-50 rounded-2xl p-6 shadow-sm border border-red-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-bold text-red-900 mb-1">Factory Reset</h3>
                    <p className="text-sm text-red-700">Completely wipes everything. Roster, catalog, settings, and logs.</p>
                </div>
                <button 
                  onClick={() => { setClearType('all'); setIsClearModalOpen(true); }} 
                  className="px-6 py-2.5 whitespace-nowrap bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition shadow-sm"
                >
                  Factory Reset
                </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SERVER INFO ═══ */}
      {activeTab === 'server' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {renderHeader('Server Info', 'dns')}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-slate-100">
                <span className="text-sm text-slate-600">Local Server API</span>
                <span className="text-sm font-mono font-semibold text-slate-900">http://{localIp}:3000/api</span>
              </div>
              <div className="flex justify-between items-center py-3 border-b border-slate-100">
                <span className="text-sm text-slate-600">Student Access URL</span>
                <span className="text-sm font-semibold text-primary bg-primary/10 px-3 py-1 rounded-md">http://{localIp}:3000</span>
              </div>
              <p className="text-xs text-slate-400 pt-2">
                Write the <strong>Student Access URL</strong> on the whiteboard. Connected clients on the same Wi-Fi network will load the application and stream books directly from this device.
              </p>
            </div>
          </section>

          {/* Windows Natural Voices Unlock */}
          {naturalVoiceStatus !== 'not_windows' && naturalVoiceStatus !== 'unlocked' && (
            <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[20px] text-primary">new_releases</span>
                  High-Quality Host Voices
                </h3>
                <p className="text-sm text-slate-500 max-w-lg mt-1">
                  {naturalVoiceStatus === 'not_installed' 
                    ? 'Download Microsoft Natural voices on the host server to significantly improve the TTS reading quality for all connected thin-clients.' 
                    : 'Natural voices are installed on this server! Unlock them so the host TTS engine can use them for all NComputing clients.'}
                </p>
              </div>
              
              {naturalVoiceStatus === 'checking' ? (
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent shrink-0" />
              ) : naturalVoiceStatus === 'not_installed' ? (
                <button
                  onClick={async () => {
                    await invoke('open_narrator_settings');
                    alert('Windows Settings opened on the host. Add a natural voice package, wait for download to complete, then return here to unlock it.');
                  }}
                  className="shrink-0 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition shadow-sm"
                >
                  Get Natural Voices
                </button>
              ) : naturalVoiceStatus === 'installed_hidden' ? (
                <button
                  onClick={async () => {
                    const success = await invoke<boolean>('unlock_natural_voices');
                    if (success) {
                      setNaturalVoiceStatus('unlocked');
                      alert('Success! Natural Voices have been unlocked. \n\nIMPORTANT: You must completely CLOSE and RESTART the Invro Libera application for the new voices to be registered by the system.');
                    }
                  }}
                  className="shrink-0 px-6 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primary/90 transition shadow-sm animate-pulse"
                >
                  Unlock Natural Voices
                </button>
              ) : null}
            </section>
          )}

        </div>
      )}

      {/* ═══ ABOUT ═══ */}
      {activeTab === 'about' && (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
          {renderHeader('About', 'info')}
          <section className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl mb-6">
              <img src="/favicon.png" alt="Invro Libera" className="h-12 w-12" />
              <div>
                <p className="font-bold text-slate-900">Invro Libera — Host</p>
                <p className="text-sm text-slate-500">v1.1.0 • Offline E-Library Server</p>
              </div>
            </div>
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">About Invro Libera</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Invro Libera is a next-generation offline digital library designed specifically for seamless integration into school computer labs and NComputing environments. It empowers students with instant access to curriculum-aligned e-books, secure progress tracking, and interactive reading tools—all without requiring an active internet connection.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2">About Invron Labs</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  At Invron Labs, we build highly scalable, hardware-optimized EdTech solutions for the modern classroom. Our mission is to bridge the digital divide by providing robust offline-first software that guarantees zero latency and maximum security for student data.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Need Assistance?</h4>
                  <p className="text-xs text-slate-500">Contact our support team</p>
                </div>
                <a href="mailto:support@invronlabs.com" className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-primary text-sm font-semibold rounded-lg transition-colors border border-slate-200">
                  support@invronlabs.com
                </a>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-8 text-center uppercase tracking-widest font-semibold">Built by Invron Labs • © 2026</p>
          </section>
        </div>
      )}

      {/* ═══ AUDIT LOGS ═══ */}
      {activeTab === 'audit' && (() => {
        const filteredLogs = auditLogs.filter(log => {
          if (auditFilter !== 'ALL' && !log.action.includes(auditFilter)) return false;
          if (auditSearch && !log.details.toLowerCase().includes(auditSearch.toLowerCase()) && !log.action.toLowerCase().includes(auditSearch.toLowerCase())) return false;
          return true;
        });

        const exportLogs = () => {
          const csvContent = "data:text/csv;charset=utf-8," 
            + "Timestamp,Action,Details\n"
            + filteredLogs.map(e => `"${new Date(e.timestamp).toISOString()}","${e.action}","${e.details.replace(/"/g, '""')}"`).join("\n");
          const encodedUri = encodeURI(csvContent);
          const link = document.createElement("a");
          link.setAttribute("href", encodedUri);
          link.setAttribute("download", `invron_audit_${new Date().toISOString().split('T')[0]}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        };

        return (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300 h-[590px] flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              {renderHeader('Server Audit Log', 'history')}
              
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
                  <input 
                    type="text" 
                    placeholder="Search logs..." 
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-48 sm:w-64 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  />
                </div>
                <select 
                  value={auditFilter} 
                  onChange={(e) => setAuditFilter(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none cursor-pointer"
                >
                  <option value="ALL">All Events</option>
                  <option value="WARN">Warnings</option>
                  <option value="ERROR">Errors</option>
                  <option value="AUTH">Authentication</option>
                  <option value="SYNC">Sync / Network</option>
                  <option value="LICENSE">License</option>
                  <option value="WIPE">Data Destructive</option>
                </select>
                <button 
                  onClick={exportLogs}
                  className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold hover:bg-slate-900 transition flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Export CSV
                </button>
              </div>
            </div>

            <section className="bg-[#0f172a] rounded-2xl shadow-xl border border-slate-800 overflow-hidden text-slate-300 font-mono text-sm flex-1 flex flex-col">
              <div className="bg-[#020617] px-6 py-3.5 border-b border-slate-800 flex justify-between items-center text-xs font-semibold tracking-wider text-slate-400">
                <div className="flex gap-4">
                  <span>TIMESTAMP (LOCAL)</span>
                  <span className="ml-24 sm:ml-[160px]">EVENT SECURE LOGSTREAM</span>
                </div>
                <span>{filteredLogs.length} Events Logged</span>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-3 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-[#0f172a] [&::-webkit-scrollbar-thumb]:bg-slate-700/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-600">
                {logsLoading ? (
                  <div className="text-center text-slate-500 py-10 animate-pulse flex flex-col items-center gap-3">
                    <span className="material-symbols-outlined text-[32px]">database</span>
                    Fetching immutable ledger...
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div className="text-center text-slate-600 py-20 flex flex-col items-center gap-3">
                    <span className="material-symbols-outlined text-[32px] opacity-50">search_off</span>
                    No server events match your criteria.
                  </div>
                ) : (
                  filteredLogs.map((log, i) => {
                    const isError = log.action.includes('WIPE') || log.action.includes('CLEAR') || log.action.includes('DELETE') || log.action.includes('ERROR') || log.action.includes('FAIL');
                    const isSuccess = log.action.includes('START') || log.action.includes('CREATE') || log.action.includes('IMPORTED') || log.action.includes('ACTIVATED') || log.action.includes('REGISTER');
                    return (
                      <div key={i} className="flex flex-col sm:flex-row sm:gap-6 border-b border-slate-800/40 pb-3 last:border-0 last:pb-0 hover:bg-slate-800/10 transition-colors rounded px-2 -mx-2 pt-2">
                        <div className="text-slate-500 text-[11px] whitespace-nowrap shrink-0 sm:w-[180px] pt-0.5">
                          {new Date(log.timestamp).toLocaleString(undefined, {
                            year: 'numeric', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit'
                          })}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`font-bold mr-3 px-1.5 py-0.5 rounded text-[10px] tracking-wider ${
                            isError ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                            isSuccess ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {log.action}
                          </span>
                          <span className="text-slate-300 text-[13px] break-words">{log.details}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        );
      })()}

      {/* Clear Data Modal */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-slate-200">
            <div className="p-6">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${clearType === 'catalog' ? 'bg-orange-100 text-orange-600' : clearType === 'roster' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'}`}>
                <span className="material-symbols-outlined text-[28px]">delete_forever</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                {clearType === 'catalog' ? 'Wipe Entire Catalog?' : clearType === 'roster' ? 'Wipe Entire Roster?' : 'Factory Reset?'}
              </h3>
              <p className="text-sm text-slate-600 mb-4">
                {clearType === 'catalog' && "This will delete all books, metadata, and progress. Your students and classes will remain."}
                {clearType === 'roster' && "This will drop all students and classes, kicking off any active sessions. Books will remain."}
                {clearType === 'license' && "This will remove the activation key from this device. You will need to import a valid .invronkey file to regain access."}
                {clearType === 'all' && "This will permanently delete everything: roster, catalog, local settings and encrypted files. This cannot be undone."}
              </p>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Type <span className="text-red-600 select-all">CLEAR</span> to confirm</label>
              <input type="text" value={clearConfirmText} onChange={e => setClearConfirmText(e.target.value)} placeholder="CLEAR" className="w-full bg-slate-50 border border-slate-300 rounded-lg px-4 py-2.5 mb-6 focus:ring-2 focus:ring-red-500/20 text-sm font-mono" />
              <div className="flex gap-3">
                <button onClick={() => { setIsClearModalOpen(false); setClearConfirmText(''); setClearType(null); }} className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-semibold rounded-xl hover:bg-slate-200 transition">Cancel</button>
                <button onClick={handleClearData} disabled={clearConfirmText !== 'CLEAR'} className="flex-1 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition disabled:opacity-50">Confirm</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
