import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Sirene',
    version: '0.4.0',
    description: 'Self-hosted multi-backend text-to-speech platform',
    identifier: 'sh.blackboard.sirene',
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    copy: {
      '../client/dist': 'Resources/client',
    },
  },
} satisfies ElectrobunConfig;
