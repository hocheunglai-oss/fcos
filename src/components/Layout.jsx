import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileBarChart2, Database, Settings, ChevronRight, Anchor } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/reports', label: 'Report Builder', icon: FileBarChart2 },
  { to: '/explorer', label: 'Data Explorer', icon: Database },
];

export default function Layout() {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 bg-sidebar flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Anchor className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-sidebar-foreground font-dm">Cosulich</div>
              <div className="text-xs text-sidebar-foreground/50">Analytics Hub</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-primary'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="text-xs text-sidebar-foreground/40">
            Connected to Salesforce
            <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-green-400 align-middle" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}