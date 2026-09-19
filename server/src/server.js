import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = new PrismaClient();
const app = await buildApp({ config, logger: true, db });
app.addHook('onClose', () => db.$disconnect());

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
