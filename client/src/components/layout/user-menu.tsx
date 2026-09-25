import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Languages, LogOut, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { useSetupStatus } from '@/hooks/use-setup-status';
import { SUPPORTED_LANGUAGES, type SupportedLanguage, setLanguage } from '@/i18n';
import { avatarUrl, userInitials } from '@/lib/user-avatar';
import { useAuth } from '@/providers/auth-provider';

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  fr: 'Français',
};

export function UserMenu() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  // The local account has no password to sign back in with.
  const canSignOut = !useSetupStatus().data?.desktop;
  const currentLanguage = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language) ? (i18n.language as SupportedLanguage) : 'en';

  if (!user) {
    return null;
  }

  const displayName = user.name?.trim() || user.email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" tooltip={displayName} className="data-[state=open]:bg-sidebar-accent">
          <Avatar size="sm" className="rounded-md">
            <AvatarImage src={avatarUrl(user)} alt="" />
            <AvatarFallback className="rounded-md group-data-[size=sm]/avatar:text-2xs">{userInitials(user)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
          <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="grid text-sm leading-tight">
            <span className="truncate font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserRound className="size-4" />
            {t('nav.profile')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages className="size-4" />
            {t('nav.language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <DropdownMenuItem key={lang} onSelect={() => setLanguage(lang)}>
                {currentLanguage === lang ? <Check className="size-3.5 text-primary" /> : <span className="size-3.5" />}
                {LANGUAGE_LABELS[lang]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {canSignOut && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout}>
              <LogOut className="size-4" />
              {t('auth.logout')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
