/**
 * Invron E-Library - Main Offline Application Component
 * Routes-based architecture with React Router v7
 */

import React, { lazy, Suspense, useCallback, useEffect, useState, Component, type ErrorInfo, type ReactNode } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useLocation, Outlet, useOutletContext } from 'react-router-dom';
import { pathToNavPage } from './navigation';
import db, { type Book, requestPersistentStorage, updateLastReadAt } from './db';
import { getClientSession, setClientSession, logoutClientSession, isTauriEnvironment, type StudentProfile } from './services/localAuth';
import { syncOnLaunch } from './services/catalogSync';
import { checkLicense, type LicenseData } from './services/licenseService';
import { listenForRemoteDownloadTriggers } from './services/telemetryService';
import { ClassSessionBanner } from './components/common/ClassSessionBanner';
import { invoke } from '@tauri-apps/api/core';

const SetupWizard = lazy(() => import('./components/SetupWizard'));

const SidebarNew = lazy(() => import('./components/layout/SidebarNew'));
const HeaderNew = lazy(() => import('./components/layout/HeaderNew'));
const HomeDashboard = lazy(() => import('./pages/HomeDashboard'));
const LibraryBrowser = lazy(() => import('./pages/LibraryBrowser'));
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PDFReader = lazy(() => import('./components/readers/PDFReader'));
const EPUBReader = lazy(() => import('./components/readers/EPUBReader'));
const Titlebar = lazy(() => import('./components/layout/Titlebar'));

const StudentLogin = lazy(() => import('./pages/StudentLogin'));

class GlobalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[GlobalErrorBoundary] Caught rendering error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
          <span className="material-symbols-outlined text-[48px] text-primary mb-4">system_update</span>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Application Error</h2>
          <button onClick={() => window.location.reload()} className="px-6 py-2.5 bg-primary text-white rounded-xl font-medium">
            Reload Now
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface AppOutletContext {
  student: StudentProfile | null;
  handleOpenBook: (book: Book) => void;
  searchQuery: string;
}

function useAppOutletContext() {
  return useOutletContext<AppOutletContext>();
}

function RouteFallback({ message = 'Loading page...' }: { message?: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center px-6 py-10">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <span>{message}</span>
      </div>
    </div>
  );
}

function AppShell({
  student,
  searchQuery,
  setSearchQuery,
  handleOpenBook,
}: {
  student: StudentProfile | null;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  handleOpenBook: (book: Book) => void;
}) {
  const location = useLocation();
  const activePage = pathToNavPage[location.pathname] || 'home';
  const isReader = location.pathname.startsWith('/reader/');
  const showSearch = activePage === 'home' || activePage === 'library';

  return (
    <Suspense fallback={<RouteFallback message="Loading workspace..." />}>
      <div className={`flex min-h-screen bg-background-light dark:bg-background-dark overflow-hidden ${isTauriEnvironment() ? 'pt-9' : ''}`}>
        {!isReader && (
          <SidebarNew
            isCollapsed={false}
            activePage={activePage}
            userName={student?.name as string || 'Student'}
            userGrade={student?.classId as string || 'Grade'}
            userRoll={student?.rollNumber as string || ''}
          />
        )}

        <div className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ${isReader ? '' : 'ml-64'}`}>
          {!isReader && (
            <HeaderNew
              showSearch={showSearch}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
          )}
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden relative">
            <Outlet context={{ student, handleOpenBook, searchQuery } satisfies AppOutletContext} />
          </main>
        </div>
      </div>
    </Suspense>
  );
}

function ReaderRoute({ resolveBookUrl }: { resolveBookUrl: (book: Book) => Promise<string | ArrayBuffer | null> }) {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [fileUrl, setFileUrl] = useState<string | ArrayBuffer | null>(null);

  useEffect(() => {
    let activeUrl: string | null = null;
    const loadBook = async () => {
      if (!bookId) return;
      const found = await db.books.get(bookId);
      if (!found) return;

      const resolved = await resolveBookUrl(found);
      if (!resolved) return;

      if (typeof resolved === 'string' && resolved.startsWith('blob:')) {
        activeUrl = resolved;
      }

      await updateLastReadAt(found.id);
      setBook({ ...found, lastReadAt: new Date(), updatedAt: new Date() });
      setFileUrl(resolved);
    };
    loadBook();

    return () => {
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, [bookId, resolveBookUrl]);

  const handleClose = useCallback(() => {
    // Navigate back to the library, not the dashboard
    navigate(isTauriEnvironment() ? '/teacher/library' : '/library');
  }, [navigate]);

  if (!book || !fileUrl) return <RouteFallback message="Preparing reader..." />;

  return book.type === 'pdf' ? (
    <Suspense fallback={<RouteFallback message="Opening book..." />}>
      <PDFReader book={book} fileUrl={fileUrl} onClose={handleClose} />
    </Suspense>
  ) : (
    <Suspense fallback={<RouteFallback message="Opening book..." />}>
      <EPUBReader book={book} fileUrl={fileUrl} onClose={handleClose} />
    </Suspense>
  );
}

function HomeRoute() {
  const { student, handleOpenBook, searchQuery } = useAppOutletContext();
  return (
    <Suspense fallback={<RouteFallback message="Loading dashboard..." />}>
      <HomeDashboard
        userName={(student?.name as string)?.split(' ')[0] || 'Device'}
        onOpenBook={handleOpenBook}
        searchQuery={searchQuery}
      />
    </Suspense>
  );
}

function LibraryRoute() {
  const { handleOpenBook, searchQuery } = useAppOutletContext();
  return (
    <Suspense fallback={<RouteFallback message="Loading library..." />}>
      <LibraryBrowser searchQuery={searchQuery} onOpenBook={handleOpenBook} />
    </Suspense>
  );
}

function FavoritesRoute() {
  const { handleOpenBook } = useAppOutletContext();
  return (
    <Suspense fallback={<RouteFallback message="Loading favorites..." />}>
      <FavoritesPage onOpenBook={handleOpenBook} />
    </Suspense>
  );
}


function SettingsRoute() {
  return (
    <Suspense fallback={<RouteFallback message="Loading settings..." />}>
      <SettingsPage />
    </Suspense>
  );
}

function App() {
  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [licenseValid, setLicenseValid] = useState<boolean | null>(null); // null = checking
  const [expiredLicense, setExpiredLicense] = useState<LicenseData | null>(null);

  useEffect(() => {
    const initialize = async () => {
      await requestPersistentStorage();
      
      if (isTauriEnvironment()) {
        // Check license before allowing access
        const result = await checkLicense();
        if (result.valid) {
          setLicenseValid(true);
        } else {
          setLicenseValid(false);
          if (result.reason === 'expired' && result.data) {
            setExpiredLicense(result.data);
          }
        }
        setIsInitialized(true);
        return;
      }

      const session = await getClientSession();
      setStudent(session);
      
      if (session) {
        syncOnLaunch().catch(e => console.error("Background sync error:", e));
      }
      
      setIsInitialized(true);
    };

    void initialize();
  }, []);

  useEffect(() => {
    // Only run heartbeat for web clients logged in
    if (isTauriEnvironment() || !student) return;

    const heartbeat = async () => {
        try {
            const host = window.location.hostname === 'tauri.localhost' ? '127.0.0.1' : window.location.hostname;
            // Get current book ID if in the reader
            const pathSegments = window.location.pathname.split('/');
            const bookId = pathSegments[1] === 'reader' && pathSegments[2] ? pathSegments[2] : null;

            const port = window.location.port || '3000';
            const res = await fetch(`http://${host}:${port}/api/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: student.id, book_id: bookId })
            });

            if (res.ok) {
                const data = await res.json();
                if (data.logout) {
                    console.log('[Heartbeat] Server requested logout.');
                    logoutClientSession();
                    setStudent(null);
                }
            }
        } catch {
            // Server offline is handled on the login page retry loop,
            // we don't strictly auto-logout on network error to prevent dropping offline work unexpectedly.
        }
    };

    void heartbeat();
    const interval = setInterval(heartbeat, 5000);
    
    // Force immediate check when tab becomes visible (bypasses background tab throttling)
    const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            void heartbeat();
        }
    };
    
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    
    return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('focus', onVisibilityChange);
    };
  }, [student]);

  // Background Library Sync for Clients
  useEffect(() => {
    if (isTauriEnvironment() || !student) return;

    const autoSync = async () => {
      try {
        const { syncCatalogForUser } = await import('./services/catalogSync');
        await syncCatalogForUser();
      } catch (err) {
        console.error('[AutoSync] Background sync failed:', err);
      }
    };

    // Initial sync
    void autoSync();
    // Subsequent syncs every 30 seconds
    const intervalId = setInterval(autoSync, 30_000);

    // Listen for teacher-triggered remote downloads
    listenForRemoteDownloadTriggers(() => {
      void autoSync();
    });

    return () => clearInterval(intervalId);
  }, [student]);

  const handleStudentLogin = useCallback((newStudent: StudentProfile) => {
    setClientSession(newStudent);
    setStudent(newStudent);
  }, []);

  const resolveBookUrl = useCallback(async (book: Book): Promise<string | ArrayBuffer | null> => {
    // 1. Already have a local blob? Use it directly.
    if (book.blob && book.blob.size > 0) return await book.blob.arrayBuffer();
    if (book.isBundled) return `/assets/books/${book.fileName}`;
    
    const host = window.location.hostname === 'tauri.localhost' ? '127.0.0.1' : window.location.hostname;
    
    // Resolve the backend server port
    let port = 3000; // Default for all environments
    if (isTauriEnvironment()) {
      // The Rust server spawns asynchronously — poll until port is assigned
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const p = await invoke<number>('get_server_port');
          if (p > 0) { port = p; break; }
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 250)); // wait 250ms between retries
      }
      console.log(`[Reader] Using server port: ${port}`);
    } else {
      // External Chrome client — use the port they connected on
      if (window.location.port) port = parseInt(window.location.port, 10);
    }

    try {
      // For EPUBs in Tauri: use pre-unpacked directory serving to bypass JSZip
      if (book.type === 'epub' && isTauriEnvironment()) {
        const streamUrl = await invoke<string>('prepare_epub_streaming', { bookId: book.id });
        const fullUrl = `http://${host}:${port}${streamUrl}/`;
        console.log(`[Reader] EPUB directory URL: ${fullUrl}`);
        return fullUrl;
      }

      // For PDFs and non-Tauri EPUBs: download the decrypted binary directly
      const url = `http://${host}:${port}/api/books/${book.id}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const buf = await res.arrayBuffer();
      console.log(`[Reader] Downloaded ${book.title} (${buf.byteLength} bytes)`);

      if (book.type === 'pdf') {
        const blob = new Blob([buf], { type: 'application/pdf' });
        return URL.createObjectURL(blob);
      }
      
      // For non-Tauri EPUBs (Chrome clients) — return raw ArrayBuffer
      return buf;
    } catch (e) {
      console.error('[Reader] resolveBookUrl failed:', e);
      return null;
    }
  }, []);

  const navigate = useNavigate();
  const handleOpenBook = useCallback((book: Book) => {
    navigate(`/reader/${book.id}`);
  }, [navigate]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent"></div>
        <p className="text-gray-600 font-medium">Initializing Invron E-Library...</p>
      </div>
    );
  }

  // License check in Tauri standalone desktop app
  if (isTauriEnvironment() && licenseValid === false) {
    return (
      <GlobalErrorBoundary>
        <Suspense fallback={<RouteFallback message="Loading Setup..." />}>
          <SetupWizard
            expiredLicense={expiredLicense}
            onActivated={() => {
              setLicenseValid(true);
              setExpiredLicense(null);
            }}
          />
        </Suspense>
      </GlobalErrorBoundary>
    );
  }

  // Student login check (In standalone desktop mode, default to Standalone Reader if no session)
  const activeStudent = student || (isTauriEnvironment() ? { id: 'STANDALONE_GUEST', name: 'Reader', classId: 'STANDALONE', rollNumber: '0' } : null);

  if (!activeStudent) {
    return (
      <GlobalErrorBoundary>
        <Suspense fallback={<RouteFallback message="Loading Login..." />}>
          <StudentLogin onLogin={handleStudentLogin} />
        </Suspense>
      </GlobalErrorBoundary>
    );
  }

  return (
    <GlobalErrorBoundary>
      <Titlebar />
      <Routes>
        <Route path="*" element={
          <div className="min-h-[calc(100vh-36px)] bg-background-light">
            <ClassSessionBanner onSessionJoined={handleStudentLogin} />
            <Routes>
              <Route element={
                <AppShell
                  student={activeStudent}
                  searchQuery={searchQuery}
                  setSearchQuery={setSearchQuery}
                  handleOpenBook={handleOpenBook}
                />
              }>
                <Route index element={<HomeRoute />} />
                <Route path="library" element={<LibraryRoute />} />
                <Route path="favorites" element={<FavoritesRoute />} />
                <Route path="settings" element={<SettingsRoute />} />
                <Route path="reader/:bookId" element={<ReaderRoute resolveBookUrl={resolveBookUrl} />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        } />
      </Routes>
    </GlobalErrorBoundary>
  );
}
export default App;
