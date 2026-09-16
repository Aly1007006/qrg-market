import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { configureApplication } from './http.js';

const logger = new ConsoleLogger({ json: true });
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(config),
    {
      bodyParser: false,
      logger,
    },
  );
  await configureApplication(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}
bootstrap().catch(() => {
  logger.error({
    event: 'startup_failed',
    message: 'Check configuration and service availability',
  });
  process.exitCode = 1;
});
