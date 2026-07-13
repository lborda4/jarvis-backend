import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  DEFAULT_IMPORT_SESSION_TTL_SECONDS,
  IMPORT_SESSION_KEY_PREFIX,
} from './constants/import-session.constants';
import { ImportSessionData } from './interfaces/import-session.interface';

interface MemorySessionEntry {
  data: string;
  expiresAt: number;
}

@Injectable()
export class ImportSessionStore implements OnModuleDestroy {
  private readonly logger = new Logger(ImportSessionStore.name);
  private readonly redis?: Redis;
  private readonly memoryStore = new Map<string, MemorySessionEntry>();
  private readonly ttlSeconds: number;

  constructor() {
    this.ttlSeconds = Number(
      process.env.IMPORT_SESSION_TTL_SECONDS ??
        DEFAULT_IMPORT_SESSION_TTL_SECONDS,
    );

    const redisUrl = process.env.REDIS_URL?.trim();

    if (redisUrl) {
      this.redis = new Redis(redisUrl);
      this.logger.log('Almacenamiento de importación configurado con Redis.');
      return;
    }

    this.logger.warn(
      'REDIS_URL no configurado. Usando almacenamiento temporal en memoria.',
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  async save(session: ImportSessionData): Promise<void> {
    const key = this.buildKey(session.rquid);
    const value = JSON.stringify(session);

    if (this.redis) {
      await this.redis.set(key, value, 'EX', this.ttlSeconds);
      return;
    }

    this.memoryStore.set(key, {
      data: value,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
    });
  }

  private buildKey(rquid: string): string {
    return `${IMPORT_SESSION_KEY_PREFIX}${rquid}`;
  }
}
