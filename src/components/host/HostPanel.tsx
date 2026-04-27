import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { StudentProfile } from '../../services/localAuth';

interface BookEntry {
  id: string;
  title: string;
  file_type: string;
  original_filename: string;
  file_size: number;
}

function parseCSV(text: string): StudentProfile[] {
  const lines = text.trim().split('\n');
  const students: StudentProfile[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length >= 3) {
      students.push({
        id: `${cols[0]}-${cols[1]}`,
        classId: cols[0],
        rollNumber: cols[1],
        name: cols[2],
      } as StudentProfile);
    }
  }
  return students;
}

export default function HostPanel() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [activeSessions, setActiveSessions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'session' | 'roster' | 'library' | 'system'>('session');
  const [books, setBooks] = useState<BookEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [appVersion, setAppVersion] = useState('...');
  const [updateStatus, setUpdateStatus] = useState('');
  const [stationCount, setStationCount] = useState('25');
  const [hostIp, setHostIp] = useState('localhost');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bookFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadState() {
      try {
        const [loadedStudents, loadedSessions, loadedBooks] = await Promise.all([
          invoke<StudentProfile[]>('get_students'),
          invoke<Record<string, string>>('get_session_mapping'),
          invoke<BookEntry[]>('get_book_catalog'),
        ]);
        setStudents(loadedStudents);
        setActiveSessions(loadedSessions);
        setBooks(loadedBooks);
        try {
          const ver = await invoke<string>('get_app_version');
          setAppVersion(ver);
        } catch { setAppVersion('0.1.0'); }
      } catch (error) {
        console.error("Failed to load Host state:", error);
      } finally {
        setLoading(false);
      }
    }
    void loadState();
  }, []);

  const handleStartSession = async () => {
    if (!selectedClass) return;
    const classStudents = students.filter(s => s.classId === selectedClass);
    if (classStudents.length === 0) return;

    const newMappings: Record<string, string> = {};
    classStudents.forEach((student, index) => {
      const stationNumber = String(index + 1).padStart(2, '0');
      newMappings[`station-${stationNumber}`] = student.id as string;
    });

    try {
      await invoke('set_session_mapping', { mappings: newMappings });
      setActiveSessions(newMappings);
    } catch (error) {
      console.error("Failed to start session:", error);
    }
  };

  const handleEndSession = async () => {
    try {
      await invoke('set_session_mapping', { mappings: {} });
      setActiveSessions({});
    } catch (error) {
      console.error("Failed to end session:", error);
    }
  };

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsed = parseCSV(text);
    if (parsed.length === 0) return;

    try {
      await invoke('import_roster', { students: parsed });
      setStudents(parsed);
    } catch (error) {
      console.error("Failed to import roster:", error);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleBookImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      for (const file of Array.from(files)) {
        // Use the webkitRelativePath or name as a path hint
        // The actual import is handled by the Rust backend via file path
        const entry = await invoke<BookEntry>('import_book', { filePath: (file as any).path || file.name });
        setBooks(prev => [...prev, entry]);
      }
    } catch (error) {
      console.error('Failed to import book:', error);
    } finally {
      setImporting(false);
      if (bookFileInputRef.current) bookFileInputRef.current.value = '';
    }
  };

  const handleDeleteBook = async (bookId: string) => {
    try {
      await invoke('delete_book', { bookId });
      setBooks(prev => prev.filter(b => b.id !== bookId));
    } catch (error) {
      console.error('Failed to delete book:', error);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const handleScanUSB = async () => {
    setUpdateStatus('Scanning USB drives...');
    // Scan common USB mount points on Windows
    const drives = ['D:\\', 'E:\\', 'F:\\', 'G:\\', 'H:\\'];
    for (const drive of drives) {
      try {
        const result = await invoke<{ found: boolean; manifest?: { version: string; description: string }; source_path: string }>('scan_for_updates', { dirPath: drive });
        if (result.found && result.manifest) {
          setUpdateStatus(`Found update v${result.manifest.version}: ${result.manifest.description}`);
          if (confirm(`Apply update v${result.manifest.version}?\n${result.manifest.description}`)) {
            const msg = await invoke<string>('apply_usb_update', { sourceDir: result.source_path });
            setUpdateStatus(`✅ ${msg}`);
          }
          return;
        }
      } catch { /* drive not available, skip */ }
    }
    setUpdateStatus('No update package found on any USB drive.');
  };

  const handleGenerateShortcuts = async () => {
    try {
      const count = parseInt(stationCount) || 25;
      const shortcuts = await invoke<string[]>('generate_station_shortcuts', {
        targetDir: 'C:\\InvronStations',
        stationCount: count,
        hostIp: hostIp,
      });
      setUpdateStatus(`✅ Created ${shortcuts.length} station shortcuts in C:\\InvronStations`);
    } catch (error) {
      console.error('Failed to generate shortcuts:', error);
      setUpdateStatus('❌ Failed to generate shortcuts');
    }
  };

  const classes = Array.from(new Set(students.map(s => s.classId)));
  const sessionCount = Object.keys(activeSessions).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50 px-8 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              Invron E-Library
            </h1>
            <p className="text-sm text-slate-400 mt-0.5">Host Server Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
              sessionCount > 0 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                : 'bg-slate-700 text-slate-400 border border-slate-600'
            }`}>
              <span className={`w-2 h-2 rounded-full ${sessionCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              {sessionCount > 0 ? `${sessionCount} Active` : 'Idle'}
            </span>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-6xl mx-auto px-8 mt-6">
        <div className="flex gap-1 bg-slate-800/50 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('session')}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'session' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Session Controller
          </button>
          <button
            onClick={() => setActiveTab('roster')}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'roster' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Student Roster ({students.length})
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'library' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            📚 Library ({books.length})
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'system' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚙️ System
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-8 py-6">
        {activeTab === 'session' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Session Controller */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5">
              <h2 className="text-lg font-semibold text-slate-200">Start a Class Session</h2>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Select Class</label>
                <select
                  className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  value={selectedClass}
                  onChange={(e) => setSelectedClass(e.target.value)}
                >
                  <option value="">— Choose Class —</option>
                  {classes.map(c => (
                    <option key={c as string} value={c as string}>{c as string}</option>
                  ))}
                </select>
              </div>
              {selectedClass && (
                <p className="text-sm text-slate-400">
                  {students.filter(s => s.classId === selectedClass).length} students will be auto-mapped to stations.
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleStartSession}
                  disabled={!selectedClass}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-semibold py-3 px-4 rounded-xl transition-all"
                >
                  ▶ Start Session
                </button>
                <button
                  onClick={handleEndSession}
                  disabled={sessionCount === 0}
                  className="flex-1 bg-red-600/80 hover:bg-red-500 disabled:opacity-40 text-white font-semibold py-3 px-4 rounded-xl transition-all"
                >
                  ■ End All
                </button>
              </div>
            </div>

            {/* Live Status */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-semibold text-slate-200">Live Lab Status</h2>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {sessionCount === 0 ? (
                  <div className="text-center py-10 text-slate-500">
                    <p className="text-3xl mb-2">📡</p>
                    <p className="text-sm">No active session. Select a class and press Start.</p>
                  </div>
                ) : (
                  Object.entries(activeSessions).map(([stationId, studentId]) => {
                    const student = students.find(s => s.id === studentId);
                    return (
                      <div key={stationId} className="flex justify-between items-center bg-slate-700/40 border border-slate-600/40 p-3.5 rounded-xl">
                        <span className="font-mono text-sm text-indigo-400">{stationId}</span>
                        <span className="text-slate-200 text-sm">{(student?.name as string) || studentId}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'roster' && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-200">Student Roster</h2>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCSVImport}
                  className="hidden"
                  id="csv-upload"
                />
                <label
                  htmlFor="csv-upload"
                  className="cursor-pointer inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all"
                >
                  📁 Import CSV
                </label>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              Upload a CSV file with columns: <code className="text-indigo-400 bg-slate-700/50 px-1.5 py-0.5 rounded">Class, RollNumber, Name</code>
            </p>

            {students.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p className="text-4xl mb-3">📋</p>
                <p>No students imported yet. Use "Import CSV" above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="py-3 px-4 text-slate-400 font-medium">Class</th>
                      <th className="py-3 px-4 text-slate-400 font-medium">Roll #</th>
                      <th className="py-3 px-4 text-slate-400 font-medium">Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s) => (
                      <tr key={s.id as string} className="border-b border-slate-700/40 hover:bg-slate-700/30 transition">
                        <td className="py-3 px-4 text-indigo-400 font-mono">{s.classId as string}</td>
                        <td className="py-3 px-4 text-slate-300">{s.rollNumber as string}</td>
                        <td className="py-3 px-4 text-white">{s.name as string}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'library' && (
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-200">Encrypted Book Library</h2>
              <div>
                <input
                  ref={bookFileInputRef}
                  type="file"
                  accept=".pdf,.epub"
                  multiple
                  onChange={handleBookImport}
                  className="hidden"
                  id="book-upload"
                />
                <label
                  htmlFor="book-upload"
                  className={`cursor-pointer inline-flex items-center gap-2 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-all ${
                    importing ? 'bg-slate-600 pointer-events-none' : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {importing ? '⏳ Encrypting...' : '📁 Import Books'}
                </label>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              Import PDF or EPUB files. They will be <strong className="text-indigo-400">AES-256 encrypted</strong> and stored securely.
            </p>

            {books.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p className="text-4xl mb-3">📚</p>
                <p>No books imported yet. Use "Import Books" to add PDF or EPUB files from a USB drive.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {books.map((book) => (
                  <div key={book.id} className="flex items-center justify-between bg-slate-700/40 border border-slate-600/40 p-4 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{book.file_type === 'pdf' ? '📕' : '📗'}</span>
                      <div>
                        <p className="text-sm font-medium text-white">{book.title}</p>
                        <p className="text-xs text-slate-400">{book.file_type.toUpperCase()} · {formatSize(book.file_size)} · Encrypted</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteBook(book.id)}
                      className="text-red-400 hover:text-red-300 text-sm px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-all"
                    >
                      🗑 Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* System Info */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5">
              <h2 className="text-lg font-semibold text-slate-200">System Information</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-slate-700/40 p-3.5 rounded-xl">
                  <span className="text-sm text-slate-400">App Version</span>
                  <span className="font-mono text-indigo-400 text-sm">v{appVersion}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-700/40 p-3.5 rounded-xl">
                  <span className="text-sm text-slate-400">Encrypted Books</span>
                  <span className="font-mono text-emerald-400 text-sm">{books.length}</span>
                </div>
                <div className="flex justify-between items-center bg-slate-700/40 p-3.5 rounded-xl">
                  <span className="text-sm text-slate-400">Student Roster</span>
                  <span className="font-mono text-amber-400 text-sm">{students.length} students</span>
                </div>
                <div className="flex justify-between items-center bg-slate-700/40 p-3.5 rounded-xl">
                  <span className="text-sm text-slate-400">Server Status</span>
                  <span className="text-emerald-400 text-sm flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Running on :3000
                  </span>
                </div>
              </div>
            </div>

            {/* USB Update */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5">
              <h2 className="text-lg font-semibold text-slate-200">USB Update</h2>
              <p className="text-sm text-slate-400">
                Plug in a USB drive containing an <code className="text-indigo-400 bg-slate-700/50 px-1.5 py-0.5 rounded">invron_update/</code> folder and scan for updates.
              </p>
              <button
                onClick={handleScanUSB}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-4 rounded-xl transition-all"
              >
                🔍 Scan USB for Updates
              </button>
              {updateStatus && (
                <p className="text-sm text-slate-300 bg-slate-700/40 p-3 rounded-xl">{updateStatus}</p>
              )}
            </div>

            {/* Station Shortcuts */}
            <div className="lg:col-span-2 bg-slate-800/60 border border-slate-700/50 rounded-2xl p-6 space-y-5">
              <h2 className="text-lg font-semibold text-slate-200">Station Deployment</h2>
              <p className="text-sm text-slate-400">
                Generate Chrome shortcuts for each NComputing station. Place them on student desktops for one-click access.
              </p>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-2">Host IP Address</label>
                  <input
                    type="text"
                    value={hostIp}
                    onChange={(e) => setHostIp(e.target.value)}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="e.g. 192.168.1.100"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-sm text-slate-400 mb-2">Stations</label>
                  <input
                    type="number"
                    value={stationCount}
                    onChange={(e) => setStationCount(e.target.value)}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    min="1"
                    max="50"
                  />
                </div>
                <button
                  onClick={handleGenerateShortcuts}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-xl transition-all whitespace-nowrap"
                >
                  ⚡ Generate Shortcuts
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
