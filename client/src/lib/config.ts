// The Go server hosts the SPA, the Sirene API and PocketBase on one origin.
export const config = {
  server: {
    url: '/api',
  },
  pb: {
    url: window.location.origin,
  },
};
