import { Link, useRouterState } from '@tanstack/react-router';
import { AudioLines, Box, Clock, LayoutDashboard, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const { t } = useTranslation();
  const router = useRouterState();
  const currentPath = router.location.pathname;

  const navItems = [
    { label: t('nav.voices'), href: '/voices', icon: AudioLines, primary: false },
    { label: t('nav.history'), href: '/history', icon: Clock, primary: false },
    { label: t('nav.dashboard'), href: '/', icon: LayoutDashboard, primary: true },
    { label: t('nav.models'), href: '/models', icon: Box, primary: false },
    { label: t('nav.settings'), href: '/settings', icon: Settings, primary: false },
  ];

  return (
    <div className="flex h-14 items-center justify-around border-t bg-background px-2">
      {navItems.map((item) => (
        <Link key={item.href} to={item.href} className={cn('flex flex-col items-center gap-0.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground', currentPath === item.href && 'text-foreground')}>
          <item.icon className={item.primary ? 'size-7' : 'size-5'} />
          <span className="text-[10px]">{item.label}</span>
        </Link>
      ))}
    </div>
  );
}
