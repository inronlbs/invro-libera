import { Suspense, useEffect, useState, useRef } from 'react';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import TeacherSidebar from '../layout/TeacherSidebar';
import HeaderNew from '../layout/HeaderNew';
import Titlebar from './Titlebar';
import type { TeacherNavItem } from '../layout/TeacherSidebar';
import { getSettings } from '../../db';
import { performAutoUpdate, type SyncSummary } from '../../services/githubPackSync';
import UpdateNotificationToast from './UpdateNotificationToast';

// Outlet context so child routes (TeacherLibrary, etc.) can access host-level search
export interface TeacherOutletContext {
  searchQuery: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTeacherOutletContext() {
  const ctx = useOutletContext<TeacherOutletContext>();
  return ctx || { searchQuery: '' };
}

function RouteFallback({ message = 'Loading workspace...' }: { message?: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center px-6 py-10">
      <div className="flex items-center gap-3 text-sm font-medium text-slate-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
        <span>{message}</span>
      </div>
    </div>
  );
}

export default function TeacherAppShell() {
  const location = useLocation();
  const isReader = location.pathname.includes('/reader/');
  const path = location.pathname.split('/')[2] || 'dashboard';
  const activePage = path as TeacherNavItem;

  const [searchQuery, setSearchQuery] = useState('');
  const [updateSummary, setUpdateSummary] = useState<SyncSummary | null>(null);
  const checkInterval = useRef<number | null>(null);

  const [prevActivePage, setPrevActivePage] = useState(activePage);
  if (prevActivePage !== activePage) {
    setPrevActivePage(activePage);
    if (activePage !== 'library') {
      setSearchQuery('');
    }
  }

  useEffect(() => {
    let mounted = true;
    
    const checkUpdate = async () => {
      try {
        const settings = await getSettings();
        if (settings.librarySyncUrl) {
          const summary = await performAutoUpdate(settings.librarySyncUrl);
          if (summary && mounted) {
            setUpdateSummary(summary);
          }
        }
      } catch (e) {
        console.error("AutoUpdate Check Failed", e);
      }
    };

    // Check immediately on mount
    checkUpdate();

    // Then check every 6 hours (6 * 60 * 60 * 1000)
    checkInterval.current = window.setInterval(checkUpdate, 21600000);

    return () => {
      mounted = false;
      if (checkInterval.current) clearInterval(checkInterval.current);
    };
  }, []);

  // Only show search on the library page
  const showSearch = activePage === 'library';

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden">
      {/* Custom Window Title Bar */}
      <Titlebar />

      <Suspense fallback={<RouteFallback message="Loading teacher workspace..." />}>
        <div className="flex flex-1 min-h-0 bg-background-light dark:bg-background-dark">
          {!isReader && <TeacherSidebar activePage={activePage} isCollapsed={false} />}

          <div className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ${isReader ? '' : 'ml-64'}`}>
            {!isReader && (
              <HeaderNew
                showSearch={showSearch}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            )}
            <main className={`flex-1 min-w-0 overflow-y-auto overflow-x-hidden ${isReader ? 'p-0' : 'p-6'} relative`}>
              <Outlet context={{ searchQuery } satisfies TeacherOutletContext} />
            </main>
          </div>

          {/* Global Update Notification for the Host */}
          {!isReader && (
            <UpdateNotificationToast 
              summary={updateSummary} 
              onDismiss={() => setUpdateSummary(null)} 
            />
          )}
        </div>
      </Suspense>
    </div>
  );
}
