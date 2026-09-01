import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Server, Socket } from 'socket.io';
import { WsAuthService } from '../../auth/services/ws-auth.service';
import { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
import { PurchaseInvoiceImportStatusService } from '../../invoices/services/purchase-invoice-import-status.service';
import { PurchaseInvoiceImportStatusResponseDto } from '../../invoices/dto/purchase-invoice-import-job.dto';
import {
  PurchaseInvoiceImportProgressEvent,
  PurchaseInvoiceImportRowResultEvent,
} from '../../invoices/interfaces/purchase-invoice-import-ws-events.interface';
import { buildPurchaseInvoiceImportJobRoom } from '../helpers/purchase-invoice-import-room.helper';

interface SocketData {
  user?: AuthenticatedUser;
}

type AuthenticatedSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

/**
 * Push en tiempo real del progreso de un job de importación de Factura de
 * compra. El cliente se conecta, se autentica en el handshake (mismo JWT
 * que usa para las llamadas REST) y se suscribe a un jobId puntual; recibe
 * un snapshot completo al suscribirse (cubre reconexión y "recién entré a
 * ver el estado") y después diffs incrementales mientras el job avanza.
 */
@WebSocketGateway({ namespace: '/ws/purchase-invoice-imports' })
export class PurchaseInvoiceImportGateway implements OnGatewayConnection {
  private readonly logger = new Logger(PurchaseInvoiceImportGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsAuthService: WsAuthService,
    private readonly statusService: PurchaseInvoiceImportStatusService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;

    try {
      const user = await this.wsAuthService.verify(token ?? '');
      client.data.user = user;
    } catch {
      client.emit('auth_error', { message: 'Token inválido o expirado.' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe_job')
  async handleSubscribeJob(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { jobId?: string },
  ): Promise<void> {
    const user = client.data.user;
    const jobId = body?.jobId?.trim();

    if (!user || !jobId) {
      return;
    }

    const companyId = getAuthenticatedCompanyId(user);
    const status = await this.statusService.getStatus(jobId, companyId);

    if (!status.jobId) {
      client.emit('job_not_found', { jobId });
      return;
    }

    await client.join(buildPurchaseInvoiceImportJobRoom(companyId, jobId));
    client.emit('job_snapshot', status);
  }

  @SubscribeMessage('unsubscribe_job')
  handleUnsubscribeJob(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { jobId?: string },
  ): void {
    const user = client.data.user;
    const jobId = body?.jobId?.trim();

    if (!user || !jobId) {
      return;
    }

    void client.leave(
      buildPurchaseInvoiceImportJobRoom(getAuthenticatedCompanyId(user), jobId),
    );
  }

  emitProgress(
    companyId: string,
    jobId: string,
    payload: PurchaseInvoiceImportProgressEvent,
  ): void {
    this.emitToJobRoom(companyId, jobId, 'job_progress', payload);
  }

  emitRowResult(
    companyId: string,
    jobId: string,
    payload: PurchaseInvoiceImportRowResultEvent,
  ): void {
    this.emitToJobRoom(companyId, jobId, 'job_row_result', payload);
  }

  emitCompleted(
    companyId: string,
    jobId: string,
    payload: PurchaseInvoiceImportStatusResponseDto,
  ): void {
    this.emitToJobRoom(companyId, jobId, 'job_completed', payload);
  }

  private emitToJobRoom(
    companyId: string,
    jobId: string,
    event: string,
    payload: unknown,
  ): void {
    if (!this.server) {
      // Estos eventos llegan acá reenviados por PurchaseInvoiceImportNotifyListenerService
      // (el worker publica por NOTIFY aunque corra en el mismo proceso, ver
      // PostgresNotifyService) — si por algún motivo el servidor de sockets
      // todavía no está listo, no hay nadie escuchando de todos modos; se
      // loguea en vez de fallar.
      this.logger.warn(
        `No se pudo emitir '${event}' para el job ${jobId}: el servidor de WebSocket todavía no está listo.`,
      );
      return;
    }

    this.server
      .to(buildPurchaseInvoiceImportJobRoom(companyId, jobId))
      .emit(event, payload);
  }
}
