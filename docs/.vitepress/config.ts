import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Sirene',
  description: 'Multi-backend text-to-speech router with a web interface',

  base: '/sirene/',

  vite: {
    server: { port: 5000 },
  },

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/api-server' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Docker', link: '/guide/docker' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'API Server (Hono)', link: '/reference/api-server' },
            {
              text: 'API Inference (FastAPI)',
              link: '/reference/api-inference',
            },
            { text: 'Models', link: '/reference/models' },
            { text: 'Database', link: '/reference/database' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/KevinBonnoron/sirene' }],
  },
});
