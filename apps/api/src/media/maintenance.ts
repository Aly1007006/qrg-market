import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Database } from '../database.js';
import { ObjectStorage, storageConfig } from './storage.js';
import { cleanupMedia } from './service.js';
@Injectable()
export class MediaMaintenance
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;
  private readonly logger = new Logger(MediaMaintenance.name);
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  onApplicationBootstrap() {
    if (this.config.environment === 'test' || !storageConfig()) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = cleanupMedia(this.db, this.storage)
        .then((result) => {
          if (result.removed)
            this.logger.log({
              event: 'media_cleanup_completed',
              removed: result.removed,
            });
        })
        .catch(() => {
          this.logger.error({ event: 'media_cleanup_failed' });
        })
        .finally(() => {
          this.running = undefined;
        });
    }, 60000);
    this.timer.unref();
  }
  async beforeApplicationShutdown() {
    clearInterval(this.timer);
    await this.running;
  }
}
