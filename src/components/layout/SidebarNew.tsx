/**
 * Invro Libera - Sidebar Navigation Component
 * Based on the new Tailwind design system
 * Uses React Router for navigation
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { navPageToPath, type NavPage } from '../../navigation';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { isTauriEnvironment } from '../../services/localAuth';

// ============================================================================
// TYPES
// ============================================================================

export type NavItem = NavPage;

interface SidebarProps {
  activePage: NavItem;
  userName?: string;
  userGrade?: string;
  userRoll?: string;
  userAvatar?: string;
}

// ============================================================================
// NAV ITEMS CONFIG
// ============================================================================

const navItems: { id: NavItem; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'library', label: 'Library', icon: 'menu_book' },
  { id: 'favorites', label: 'Favorites', icon: 'favorite' },
];



// ============================================================================
// COMPONENT
// ============================================================================

interface ExtendedSidebarProps extends SidebarProps {
  isCollapsed?: boolean;
}

export default function SidebarNew({
  activePage,
  userName = 'Reader',
  userGrade = 'Grade 11',
  userRoll = '',
  userAvatar,
  isCollapsed = false,
}: ExtendedSidebarProps) {
  const isTauri = isTauriEnvironment();
  const navigate = useNavigate();
  const { isInstallable, isInstalled, promptInstall } = usePwaInstall();
  const [showSettingsMenu, setShowSettingsMenu] = useState(activePage === 'settings');
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const desktopMenuRef = useRef<HTMLElement>(null);
  const isSettingsMenuVisible = activePage === 'settings' || showSettingsMenu;


  const handleNavigate = (page: NavItem) => {
    // Only close settings submenu when navigating AWAY from settings
    if (page !== 'settings') {
      setShowSettingsMenu(false);
    }
    navigate(navPageToPath[page]);
  };



  // Close submenu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const isOutsideMobile = mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node);
      const isOutsideDesktop = desktopMenuRef.current && !desktopMenuRef.current.contains(e.target as Node);

      if (isOutsideMobile && isOutsideDesktop) {
        // Only close if we're not on the settings page
        if (activePage !== 'settings') {
          setShowSettingsMenu(false);
        }
      }
    };
    if (isSettingsMenuVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSettingsMenuVisible, activePage]);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside ref={desktopMenuRef} className={`
        flex fixed left-0 bg-white border-r border-slate-200 flex-col shrink-0 transition-all duration-300 z-50
        ${isTauri ? 'top-9 h-[calc(100vh-36px)]' : 'top-0 h-screen'}
        ${isCollapsed ? 'w-20' : 'w-64'}
      `}>
        {/* Logo */}
        <div className="p-4 flex items-center justify-center">
          <div className="shrink-0">
            <img src="/assets/logos/logo-txt-dark.png" alt="Invro Libera" className="h-10 w-auto object-contain" />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-left
                ${activePage === item.id
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800 hover:text-slate-900 dark:hover:text-neutral-200'
                }
              `}
            >
              <span className={`material-symbols-outlined ${activePage === item.id ? 'fill' : ''}`}>
                {item.icon}
              </span>
              {!isCollapsed && <span className="text-sm font-medium">{item.label}</span>}
            </button>
          ))}

          {/* Settings — simple nav, no submenu */}
          <div className="mt-auto">
            <button
              onClick={() => handleNavigate('settings')}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-left
                ${activePage === 'settings'
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-600 hover:bg-slate-100'
                }
              `}
            >
              <span className="material-symbols-outlined">settings</span>
              {!isCollapsed && <span className="text-sm font-medium">Settings</span>}
            </button>
          </div>
        </nav>

        {/* Global Action: Install PWA (only shows on web browsers) */}
        {!isCollapsed && isInstallable && !isInstalled && (
          <div className="px-3 pb-3">
            <button
              onClick={promptInstall}
              className="flex items-center justify-center gap-2 w-full bg-primary/10 text-primary hover:bg-primary hover:text-white px-3 py-2 rounded-lg font-medium transition-colors border border-primary/20"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Install App
            </button>
          </div>
        )}

        {/* User Profile */}
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 p-2 rounded-lg bg-slate-50">
            <div
              className="size-10 rounded-full bg-cover bg-center bg-primary/20 shrink-0"
              style={userAvatar ? { backgroundImage: `url('${userAvatar}')` } : undefined}
            >
              {!userAvatar && (
                <div className="w-full h-full flex items-center justify-center text-primary font-bold">
                  {userName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <p className="text-sm font-semibold truncate text-slate-900">{userName}</p>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  {userRoll ? `Roll No. ${userRoll}` : userGrade}
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>

    </>
  );
}
