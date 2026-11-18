import { startServer } from './app.ts';

await startServer(Number(process.env.PORT ?? 8787));
