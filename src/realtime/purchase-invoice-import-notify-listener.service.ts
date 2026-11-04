import {
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { AppConfiguration } from '../config/configuration';
import { PurchaseInvoiceImportGateway } from './gateways/purchase-invoice-import.gateway';
import {
  PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL,
  PurchaseInvoiceImportNotifyEvent,
} from './interfaces/purchase-invoice-import-notify-event.interface';

/**
 * Lado "listener" del puente Postgres LISTEN/NOTIFY. API y worker corren en
 * el mismo proceso (ver PurchaseInvoiceImportWorkerService), pero si la app
 * escala a varias instancias, el worker in-process de la instancia A no
 * puede llamar directo a los métodos del gateway de la instancia B (viven
 * en memoria de procesos distintos); en cambio, cada worker publica por
 * NOTIFY (ver PostgresNotifyService) y cada instancia lo recibe acá y lo
 * reenvía a los clientes de WebSocket conectados a ELLA.
 *
 * Usa un `pg.Client` dedicado (no el pool de TypeORM) porque LISTEN
 * requiere mantener la misma conexión abierta indefinidamente para poder
 * recibir notificaciones — un pool devuelve y reutiliza conexiones, lo que
 * rompería la suscripción.
 */
@Injectable()
export class PurchaseInvoiceImportNotifyListenerService
  implements OnApplicationShutdown
{
  private readonly logger = new Logger(
    PurchaseInvoiceImportNotifyListenerService.name,
  );
  private client: Client | null = null;
  private stopped = false;
  private connecting: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly gateway: PurchaseInvoiceImportGateway,
  ) {
    this.gateway.beforeSubscribe = () => this.ensureConnected();
  }

  /** Conecta al suscribirse un usuario, nunca por un temporizador. */
  ensureConnected(): Promise<void> {
    if (this.client || this.stopped) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    void this.client?.end();
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const client = new Client({
      connectionString: this.configService.get('database.url', {
        infer: true,
      }),
      ssl: { rejectUnauthorized: false },
    });

    client.on('notification', (message) => this.handleNotification(message));
    client.on('end', () => {
      if (this.client === client) this.client = null;
    });
    client.on('error', (error) => {
      this.logger.warn(
        `Conexión de LISTEN interrumpida: ${error.message}. Se reconectará en la próxima suscripción.`,
      );
      if (this.client === client) this.client = null;
      void client.end().catch(() => undefined);
    });

    try {
      await client.connect();
      if (this.stopped) {
        await client.end();
        return;
      }
      await client.query(`LISTEN ${PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL}`);
      this.client = client;
      this.logger.log(
        `Escuchando '${PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL}' para reenviar progreso de importación por WebSocket.`,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo conectar para LISTEN: ${
          error instanceof Error ? error.message : String(error)
        }. Se podrá reintentar en la próxima suscripción.`,
      );
      void client.end().catch(() => undefined);
    }
  }

  private handleNotification(message: { payload?: string }): void {
    if (!message.payload) {
      return;
    }

    let event: PurchaseInvoiceImportNotifyEvent;

    try {
      event = JSON.parse(message.payload) as PurchaseInvoiceImportNotifyEvent;
    } catch {
      this.logger.warn('Notificación con payload no parseable, se ignora.');
      return;
    }

    switch (event.event) {
      case 'progress':
        this.gateway.emitProgress(
          event.companyId,
          event.payload.jobId,
          event.payload,
        );
        break;
      case 'row':
        this.gateway.emitRowResult(
          event.companyId,
          event.payload.jobId,
          event.payload,
        );
        break;
      case 'completed':
        if (event.payload.jobId) {
          this.gateway.emitCompleted(
            event.companyId,
            event.payload.jobId,
            event.payload,
          );
        }
        break;
    }
  }
}
