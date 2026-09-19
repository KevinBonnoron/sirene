import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SectionTopbar } from '@/components/layout/section-topbar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/providers/auth-provider';
import { AccountSection } from './account-section';
import { ApiKeysSection } from './api-keys-section';
import { AppearanceSection } from './appearance-section';
import { CloudKeysSection } from './cloud-keys-section';

export const PROFILE_TABS = ['account', 'appearance', 'cloud', 'apiKeys'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

const DESCRIPTION: Record<ProfileTab, string> = {
  account: 'profile.subtitle',
  appearance: 'appearance.description',
  cloud: 'cloudKeys.description',
  apiKeys: 'apiKeys.description',
};

export function ProfilePage({ tab }: { tab: ProfileTab }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <SectionTopbar label={t('nav.profile')} subtitle={t(DESCRIPTION[tab])} />
      <Tabs value={tab} onValueChange={(next) => navigate({ to: '/profile', search: { tab: next as ProfileTab }, replace: true })} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="custom-scrollbar shrink-0 overflow-x-auto border-b border-border-subtle px-6 py-3">
          <TabsList>
            {PROFILE_TABS.map((name) => (
              <TabsTrigger key={name} value={name}>
                {t(`profile.tabs.${name}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <main className={`custom-scrollbar min-h-0 flex-1 overflow-y-auto p-6 ${isMobile ? 'pb-24' : ''}`}>
          <TabsContent value="account">
            <AccountSection user={user} />
          </TabsContent>
          <TabsContent value="appearance">
            <AppearanceSection />
          </TabsContent>
          <TabsContent value="cloud">
            <CloudKeysSection />
          </TabsContent>
          <TabsContent value="apiKeys">
            <ApiKeysSection />
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}
