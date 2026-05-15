export const config = {
  server: {
    url: import.meta.env.VITE_SERVER_URL ?? '/api',
  },
  pb: {
    url: import.meta.env.VITE_PB_URL || 'http://localhost:8090',
  },
};
