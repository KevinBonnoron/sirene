import { app } from './server';

export { app };

export default {
  port: 3000,
  hostname: '0.0.0.0',
  fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request);
  },
  idleTimeout: 255,
};
