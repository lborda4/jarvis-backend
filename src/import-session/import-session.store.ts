import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  IMPORT_SESSION_KEY_PREFIX,
} from './constants/import-session.constants';
import { ImportSessionData } from './interfaces/import-session.interface';
import { AppConfiguration } from '../config/configuration';

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

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
  ) {
    this.ttlSeconds = this.configService.get('redis.importSessionTtlSeconds', {
      infer: true,
    });

    const redisUrl = this.configService.get('redis.url', { infer: true });

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
