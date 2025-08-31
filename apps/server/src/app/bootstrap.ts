import dotenv from 'dotenv';
import path from 'path';
import { buildServer } from './server';

export async function bootstrap() {
  const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });

  const app = buildServer();

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  try {
    await app.ready();
    await app.listen({ port, host });
    app.log.info(`Server running on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}


