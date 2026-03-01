import { Link, useRouterState } from '@tanstack/react-router';
import { Box, Clock, LogOut, Mic, Moon, Settings, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-provider';

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

  const navItems = [
    { label: t('nav.generate'), href: '/', icon: Mic },
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
      </SidebarContent>
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
