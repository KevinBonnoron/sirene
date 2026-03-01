import type { CatalogModel, Model } from '@sirene/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ModelTile } from './model-tile';

interface Props {
  backend: string;
  description: string;
  models: { catalog: CatalogModel; installation?: Model }[];
  onPull: (id: string) => void;
}

export function ModelCard({ backend, description, models, onPull }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium capitalize">{backend}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {models.map(({ catalog, installation }) => (
            <ModelTile key={catalog.id} catalog={catalog} installation={installation} onPull={onPull} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
