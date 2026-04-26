import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { sessionCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface Props {
  pendingId: string | null;
  pendingName: string;
  onClose: () => void;
}

export function DeleteSessionAlert({ pendingId, pendingName, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouterState();
  const activeSessionId = (router.location.search as { session?: string } | undefined)?.session ?? null;

  async function handleDelete() {
    if (!pendingId) {
      return;
    }
    const wasActive = activeSessionId === pendingId;
    try {
      await sessionCollection.delete(pendingId).isPersisted.promise;
      if (wasActive) {
        navigate({ to: '/', search: {}, replace: true });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('studio.failedToDeleteSession'));
    } finally {
      onClose();
    }
  }

  return (
    <AlertDialog
      open={pendingId !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('studio.deleteSessionTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('studio.deleteSessionDescription', { name: pendingName })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
