import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfiguration } from '../../config/configuration';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { SubscriptionStatus } from '../../plan/enums/subscription-status.enum';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoPurchaseSyncJobsRepository } from '../repositories/siigo-purchase-sync-jobs.repository';
import { SiigoPurchaseSyncJobStatus } from '../enums/siigo-purchase-sync-job-status.enum';
import { SiigoPurchaseHistorySyncService } from './siigo-purchase-history-sync.service';
import { sleep } from './helpers/siigo-auth.helper';

/**
 * Mantiene fresco, solo, el sync de historial de compras de cada empresa
 * SIIGO — sin que nadie tenga que acordarse de darle a "Sincronizar" desde
 * Configuración. Reusa exactamente el mismo SiigoPurchaseHistorySyncService
 * que ya dispara el paso 2 de configuración y el botón manual: este
 * servicio solo decide CUÁNDO llamarlo por empresa.
 *
 * Mismo patrón que PurchaseInvoiceImportWorkerService (loop de polling
 * propio con setTimeout+unref, sin colas ni librerías de cron externas):
 * corre dentro del mismo proceso Nest, no bloquea nada del flujo normal —
 * el chequeo periódico solo lee un par de tablas y, para las empresas
 * vencidas, llama a startSync (que a su vez dispara el sync real de forma
 * fire-and-forget, ver SiigoPurchaseHistorySyncService.startSync). El
 * usuario nunca lo nota: no hay ningún endpoint ni pantalla que dependa de
 * ESTE servicio, y startSync ya es idempotente por empresa (si ya hay un
 * sync 'running', lo reusa en vez de duplicar trabajo).
 */
@Injectable()
export class SiigoPurchaseHistoryAutoSyncService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    SiigoPurchaseHistoryAutoSyncService.name,
  );
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoPurchaseSyncJobsRepository: SiigoPurchaseSyncJobsRepository,
    private readonly siigoPurchaseHistorySyncService: SiigoPurchaseHistorySyncService,
  ) {}

  onApplicationBootstrap(): void {
    // Arranca con un margen (30s) para no competir con el resto de
    // servicios que también inician en el boot — nunca resincroniza TODO
    // apenas prende el proceso, el primer chequeo igual filtra por
    // staleAfterHours como cualquier otro tick.
    this.scheduleNextTick(30_000);
  }

  onApplicationShutdown(): void {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    const checkIntervalMs = this.configService.get(
      'siigoPurchaseHistoryAutoSync.checkIntervalMs',
      { infer: true },
    );

    try {
      await this.runOneCheck();
    } catch (error) {
      this.logger.error(
        'Error inesperado revisando qué empresas resincronizar en segundo plano',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.scheduleNextTick(checkIntervalMs);
    }
  }

  private async runOneCheck(): Promise<void> {
    const integrations =
      await this.integrationsRepository.findAllActiveByProviderAndSubscription(
        IntegrationProvider.SIIGO,
        SubscriptionStatus.ACTIVE,
      );

    if (integrations.length === 0) {
      return;
    }

    const staleAfterHours = this.configService.get(
      'siigoPurchaseHistoryAutoSync.staleAfterHours',
      { infer: true },
    );
    const startStaggerMs = this.configService.get(
      'siigoPurchaseHistoryAutoSync.startStaggerMs',
      { infer: true },
    );
    const staleCutoff = new Date(
      Date.now() - staleAfterHours * 60 * 60 * 1000,
    );

    const dueCompanyIds: string[] = [];

    for (const integration of integrations) {
      const latestJob =
        await this.siigoPurchaseSyncJobsRepository.findLatestByCompany(
          integration.companyId,
          integration.id,
        );

      const isRunning = latestJob?.status === SiigoPurchaseSyncJobStatus.RUNNING;
      const isFresh =
        latestJob?.completedAt != null && latestJob.completedAt > staleCutoff;

      if (!isRunning && !isFresh) {
        dueCompanyIds.push(integration.companyId);
      }
    }

    if (dueCompanyIds.length === 0) {
      return;
    }

    this.logger.log(
      `Resync automático de historial de compras: ${dueCompanyIds.length} empresa(s) con el último sync vencido (>${staleAfterHours}h) o sin sincronizar nunca.`,
    );

    // Se espacia el ARRANQUE de cada sync (no la espera a que termine —
    // startSync ya es fire-and-forget) para no lanzar varias
    // sincronizaciones completas de golpe si muchas empresas vencen a la
    // vez: cada una ya pagina/pide a SIIGO con su propia concurrencia
    // interna (ver SYNC_PAGE_FETCH_CONCURRENCY), así que esto es lo que
    // realmente controla la carga a nivel de TODO el proceso.
    for (const companyId of dueCompanyIds) {
      try {
        await this.siigoPurchaseHistorySyncService.startSync(companyId);
      } catch (error) {
        this.logger.error(
          `[companyId=${companyId}] No se pudo iniciar el resync automático de historial de compras`,
          error instanceof Error ? error.stack : String(error),
        );
      }

      await sleep(startStaggerMs);
    }
  }
}
