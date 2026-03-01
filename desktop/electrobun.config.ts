import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'Sirene',
    version: '0.0.1',
    description: 'Self-hosted multi-backend text-to-speech platform',
    identifier: 'sh.blackboard.sirene',
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    copy: {
      '../client/dist': 'Resources/client',
      '../db/pb_migrations': 'Resources/pb_migrations',
      [process.platform === 'win32' ? './vendor/pocketbase.exe' : './vendor/pocketbase']: 'Resources/pocketbase',
      '../inference/src': 'Resources/inference/src',
      './vendor/python': 'Resources/python',
      './vendor/server.js': 'Resources/server.js',
    },
  },
} satisfies ElectrobunConfig;
