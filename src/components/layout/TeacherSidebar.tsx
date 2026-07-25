/**
 * Invro Libera - Teacher (Host) Sidebar Navigation
 * Tailwind-based sidebar for the Host desktop application.
 */

import { useNavigate } from 'react-router-dom';

export type TeacherNavItem = 'dashboard' | 'classes' | 'library' | 'settings';

const navItems: { id: TeacherNavItem; label: string; icon: string; path: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'space_dashboard', path: '/teacher' },
  { id: 'classes',   label: 'Classes',   icon: 'school',          path: '/teacher/classes' },
  { id: 'library',   label: 'Library',   icon: 'menu_book',       path: '/teacher/library' },
  { id: 'settings',  label: 'Settings',  icon: 'settings',        path: '/teacher/settings' },
];

interface TeacherSidebarProps {
  activePage: TeacherNavItem;
  isCollapsed?: boolean;
}

export default function TeacherSidebar({ activePage, isCollapsed = false }: TeacherSidebarProps) {
  const navigate = useNavigate();

  return (
    <aside className={`
      flex fixed top-8 left-0 bg-white border-r border-slate-200 flex-col h-[calc(100vh-2rem)] shrink-0 transition-all duration-300 z-50
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
        {navItems.filter(i => i.id !== 'settings').map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-left
              ${activePage === item.id
                ? 'bg-primary/10 text-primary'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }
            `}
          >
            <span className={`material-symbols-outlined ${activePage === item.id ? 'fill' : ''}`}>
              {item.icon}
            </span>
            {!isCollapsed && <span className="text-sm font-medium">{item.label}</span>}
          </button>
        ))}

        {/* Settings pinned to bottom */}
        <div className="mt-auto">
          <button
            onClick={() => navigate('/teacher/settings')}
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

      {/* Host Badge */}
      {!isCollapsed && (
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 p-2 rounded-lg bg-slate-50">
            <div className="size-10 rounded-full bg-primary/20 shrink-0 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary text-[20px]">dns</span>
            </div>
            <div className="flex flex-col min-w-0">
              <p className="text-sm font-semibold truncate text-slate-900">Host Server</p>
              <p className="text-xs text-slate-500 truncate mt-0.5">Invro Libera</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
