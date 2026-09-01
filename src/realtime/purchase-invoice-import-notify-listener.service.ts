import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
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

const RECONNECT_DELAY_MS = 3000;

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
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    PurchaseInvoiceImportNotifyListenerService.name,
  );
  private client: Client | null = null;
  private stopped = false;

  constructor(
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly gateway: PurchaseInvoiceImportGateway,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.connect();
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
    client.on('error', (error) => {
      this.logger.warn(
        `Conexión de LISTEN interrumpida: ${error.message}. Reintentando en ${RECONNECT_DELAY_MS}ms.`,
      );
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL}`);
      this.client = client;
      this.logger.log(
        `Escuchando '${PURCHASE_INVOICE_IMPORT_NOTIFY_CHANNEL}' para reenviar progreso de importación por WebSocket.`,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo conectar para LISTEN: ${
          error instanceof Error ? error.message : String(error)
        }. Reintentando en ${RECONNECT_DELAY_MS}ms.`,
      );
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.client = null;
    setTimeout(() => void this.connect(), RECONNECT_DELAY_MS).unref();
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
