export const config = {
  pb: {
    url: process.env.POCKETBASE_URL ?? 'http://localhost:8090',
    adminEmail: process.env.PB_SUPERUSER_EMAIL ?? 'admin@sirene.local',
    adminPassword: process.env.PB_SUPERUSER_PASSWORD ?? 'changeme123',
  },
  inferenceUrl: process.env.INFERENCE_URL ?? 'http://localhost:8000',
};
