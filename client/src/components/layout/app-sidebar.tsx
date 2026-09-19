import { useLiveQuery } from '@tanstack/react-db';
import { Link, useRouterState } from '@tanstack/react-router';
import { AudioLines, Box, Clock, MessageSquareText, Mic, MoreHorizontal, Server, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sessionCollection } from '@/collections';
import { DeleteSessionAlert } from '@/components/studio/delete-session-alert';
import { SessionsDialog } from '@/components/studio/sessions-dialog';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { useOwnGenerations } from '@/hooks/use-own-generations';
import { useAuth } from '@/providers/auth-provider';
import { UserMenu } from './user-menu';

const RECENT_SESSIONS_LIMIT = 5;

export function AppSidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouterState();
  const currentPath = router.location.pathname;
  const activeSessionId = (router.location.search as { session?: string } | undefined)?.session ?? null;

  const { data: sessions } = useLiveQuery((q) => q.from({ s: sessionCollection }).orderBy(({ s }) => s.updated, 'desc'));
  const { data: generations } = useOwnGenerations();
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const allSessions = sessions ?? [];
  const recentSessions = allSessions.slice(0, RECENT_SESSIONS_LIMIT);
  const hasMoreSessions = allSessions.length > RECENT_SESSIONS_LIMIT;

  useKeyboardShortcut(() => setSessionsDialogOpen(true), { key: 'k' }, allSessions.length > 0);

  const navItems = [
    { label: t('nav.studio'), href: '/', icon: Mic },
    { label: t('nav.voices'), href: '/voices', icon: AudioLines },
    { label: t('nav.models'), href: '/models', icon: Box },
    { label: t('nav.history'), href: '/history', icon: Clock },
  ];
  const adminItems = [
    { label: t('instance.title'), href: '/admin/general', icon: SlidersHorizontal },
    { label: t('nav.inferenceServers'), href: '/admin/inference-servers', icon: Server },
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
        {user?.role === 'admin' && (
          <SidebarGroup>
            <SidebarGroupLabel>{t('nav.admin')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
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
        )}
      </SidebarContent>

      <SessionsDialog open={sessionsDialogOpen} onOpenChange={setSessionsDialogOpen} sessions={allSessions} generations={generations ?? []} activeSessionId={activeSessionId} onRequestDelete={(id, name) => setPendingDelete({ id, name })} />
      <DeleteSessionAlert pendingId={pendingDelete?.id ?? null} pendingName={pendingDelete?.name ?? ''} onClose={() => setPendingDelete(null)} />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <UserMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
