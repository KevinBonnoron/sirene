export const config = {
  server: {
    url: import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000/api',
  },
  pb: {
    url: import.meta.env.VITE_PB_URL || 'http://localhost:8090',
  },
};
