import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { generationCollection } from '@/collections';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface Props {
  generationIds: string[];
  voiceName: string;
  onDeleted?: () => void;
}

export function DeleteAllGenerationsButton({ generationIds, voiceName, onDeleted }: Props) {
  const { t } = useTranslation();

  function handleDelete() {
    for (const id of generationIds) {
      generationCollection.delete(id);
    }
    onDeleted?.();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="mr-2 size-3.5" />
          {t('history.deleteAll')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('history.deleteAllTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('history.deleteAllDescription', { count: generationIds.length, voice: voiceName })}</AlertDialogDescription>
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
