import { useLiveQuery } from '@tanstack/react-db';
import { Link, useRouterState } from '@tanstack/react-router';
import { AudioLines, Box, Clock, LogOut, MessageSquareText, Mic, Moon, MoreHorizontal, Settings, Sun, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generationCollection, sessionCollection } from '@/collections';
import { DeleteSessionAlert } from '@/components/studio/delete-session-alert';
import { SessionsDialog } from '@/components/studio/sessions-dialog';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

/** How many recent sessions to show inline in the sidebar before falling back to the dialog. */
const RECENT_SESSIONS_LIMIT = 5;

function ThemeToggleButton() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const toggle = () => setTheme(theme === 'light' ? 'dark' : 'light');
  return (
    <SidebarMenuButton tooltip={t('nav.toggleTheme')} onClick={toggle}>
      {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span>{t('nav.theme')}</span>
    </SidebarMenuButton>
  );
}

function LogoutButton() {
  const { t } = useTranslation();
  const { logout, user } = useAuth();
  return (
    <SidebarMenuButton tooltip={user?.email ?? t('auth.logout')} onClick={logout}>
      <LogOut className="size-4" />
      <span>{t('auth.logout')}</span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const { t } = useTranslation();
  const router = useRouterState();
  const currentPath = router.location.pathname;
  // Active session id is in the URL search (`?session=<id>`). Read it loosely so we don't have to
  // type-narrow on the route — the sidebar lives on every page.
  const activeSessionId = (router.location.search as { session?: string } | undefined)?.session ?? null;

  const { data: sessions } = useLiveQuery((q) => q.from({ s: sessionCollection }).orderBy(({ s }) => s.updated, 'desc'));
  const { data: generations } = useLiveQuery((q) => q.from({ gens: generationCollection }).orderBy(({ gens }) => gens.created, 'desc'));
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const allSessions = sessions ?? [];
  const recentSessions = allSessions.slice(0, RECENT_SESSIONS_LIMIT);
  const hasMoreSessions = allSessions.length > RECENT_SESSIONS_LIMIT;

  const navItems = [
    { label: t('nav.studio'), href: '/', icon: Mic },
    { label: t('nav.voices'), href: '/voices', icon: AudioLines },
    { label: t('nav.models'), href: '/models', icon: Box },
    { label: t('nav.history'), href: '/history', icon: Clock },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="overflow-hidden px-4 py-4 group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:py-3">
        <h1 className="truncate text-xl font-bold tracking-tight group-data-[collapsible=icon]:hidden">{t('nav.appName')}</h1>
        <p className="truncate text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">{t('nav.appSubtitle')}</p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.navigation')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={currentPath === item.href} tooltip={item.label}>
                    <Link to={item.href}>
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Recent sessions — hidden when sidebar collapses to icons (no room for the list). */}
        {recentSessions.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>{t('nav.sessions')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentSessions.map((session) => {
                  const isActive = currentPath === '/' && session.id === activeSessionId;
                  const displayName = session.name?.trim().length ? session.name : t('studio.untitledSession');
                  return (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={displayName}>
                        <Link to="/" search={{ session: session.id }}>
                          <MessageSquareText className="size-4" />
                          <span className={!session.name?.trim() ? 'italic text-dim' : undefined}>{displayName}</span>
                        </Link>
                      </SidebarMenuButton>
                      <SidebarMenuAction
                        showOnHover
                        onClick={(e) => {
                          // The action is positioned over the link — stop the click from bubbling
                          // through into navigation.
                          e.preventDefault();
                          e.stopPropagation();
                          setPendingDelete({ id: session.id, name: displayName });
                        }}
                        aria-label={t('common.delete')}
                        className="hover:text-destructive"
                      >
                        <Trash2 />
                      </SidebarMenuAction>
                    </SidebarMenuItem>
                  );
                })}
                {hasMoreSessions && (
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={() => setSessionsDialogOpen(true)} tooltip={t('studio.allSessions')} className="text-muted-foreground">
                      <MoreHorizontal className="size-4" />
                      <span>{t('studio.allSessions')}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SessionsDialog open={sessionsDialogOpen} onOpenChange={setSessionsDialogOpen} sessions={allSessions} generations={generations ?? []} activeSessionId={activeSessionId} onRequestDelete={(id, name) => setPendingDelete({ id, name })} />
      <DeleteSessionAlert pendingId={pendingDelete?.id ?? null} pendingName={pendingDelete?.name ?? ''} onClose={() => setPendingDelete(null)} />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggleButton />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={currentPath === '/settings'} tooltip={t('nav.settings')}>
              <Link to="/settings">
                <Settings className="size-4" />
                <span>{t('nav.settings')}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <LogoutButton />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
