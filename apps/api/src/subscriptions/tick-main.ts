import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../config.js';
import { SubscriptionService } from './service.js';
const app = await NestFactory.createApplicationContext(
  AppModule.register(loadConfig()),
  { logger: false },
);
try {
  console.log(
    JSON.stringify({
      event: 'billing_deadlines_completed',
      ...(await app.get(SubscriptionService).tick()),
    }),
  );
} catch {
  console.error(JSON.stringify({ event: 'billing_deadlines_failed' }));
  process.exitCode = 1;
} finally {
  await app.close();
}
