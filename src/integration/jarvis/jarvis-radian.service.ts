import { JarvisRadianEventsRepository } from './repositories/jarvis-radian-events.repository';
import type { JarvisRadianEvent } from './entities/jarvis-radian-event.entity';
import type { RadianEventResult } from './nextpyme/nextpyme-radian-result';
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { SubscriptionStatus } from '../../plan/enums/subscription-status.enum';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';

@Injectable()
export class JarvisRadianService {
  constructor(
    private readonly companies: CompaniesRepository,
    private readonly integrations: IntegrationsRepository,
    private readonly client: NextPymeApiClient,
    private readonly events: JarvisRadianEventsRepository,
  ) {}

  async lookup(companyId: string, cufe: string) {
    if (typeof cufe !== 'string' || !/^[a-f0-9]{96}$/i.test(cufe.trim()))
      throw new BadRequestException('El CUFE no es válido.');
    const integration = await this.integrations.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.JARVIS,
    );
    if (
      !integration ||
      (integration.subscriptionStatus != null &&
        integration.subscriptionStatus !== SubscriptionStatus.ACTIVE)
    )
      throw new ForbiddenException(
        'Esta función requiere una integración Jarvis activa.',
      );
    const company = await this.companies.findById(companyId);
    const token = company?.nextPymeToken?.trim();
    if (!token)
      throw new BadRequestException(
        'La configuración de la empresa no está completa.',
      );
    const normalizedCufe = cufe.trim().toLowerCase();
    const result = await this.client.getInvoiceByCufe(normalizedCufe, token);
    if (result.outcome === 'not_found')
      throw new BadRequestException('No se encontró una factura para este CUFE. Verifica la información ingresada.');
    if (result.outcome !== 'found')
      throw new BadGatewayException(
        'No pudimos consultar la factura. Inténtalo más tarde o comunícate con soporte.',
      );
    const data = result.data;
    const nit = (value: unknown) =>
      String(value ?? '')
        .split('-')[0]
        .replace(/\D/g, '');
    if (
      !nit(data.customer?.identification_number) ||
      !nit(company?.nit) ||
      nit(data.customer?.identification_number) !== nit(company?.nit)
    )
      throw new BadRequestException(
        'La factura no corresponde a una compra recibida por la empresa activa. Verifica la información y la empresa seleccionada.',
      );
    if (
      ![1, 2].includes(Number(data.type_document_id))
    )
      throw new BadRequestException(
        'El documento consultado no es una factura electrónica de venta válida para RADIAN. Verifica el CUFE ingresado.',
      );
    if (
      Number(data.payment_form?.payment_form_id) !== 2
    )
      throw new BadRequestException(
        'La factura no está identificada como una venta a crédito. RADIAN requiere forma de pago 2 (crédito). Verifica la información del documento.',
      );
    const number = String(data.number ?? '');
    const prefix = data.prefix ?? '';
    return {
      cufe: normalizedCufe,
      number: number.startsWith(prefix) ? number : prefix + number,
      supplier: data.seller?.name ?? '',
      nit: String(data.seller?.identification_number ?? ''),
      date: data.date?.slice(0, 10) ?? '',
      valid: true,
    };
  }

  async send(
    companyId: string,
    request: { cufe?: string; eventId?: number; typeRejectionId?: number },
  ) {
    if (
      !request ||
      typeof request.cufe !== 'string' ||
      !/^[a-f0-9]{96}$/i.test(request.cufe.trim()) ||
      ![1, 2, 3, 4].includes(request.eventId as number)
    )
      throw new BadRequestException('El CUFE o el evento no son válidos.');
    const integration = await this.integrations.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.JARVIS,
    );
    if (
      !integration ||
      (integration.subscriptionStatus != null &&
        integration.subscriptionStatus !== SubscriptionStatus.ACTIVE)
    )
      throw new ForbiddenException(
        'Esta función requiere una integración Jarvis activa.',
      );
    const company = await this.companies.findById(companyId);
    const token = company?.nextPymeToken?.trim();
    if (!token)
      throw new BadRequestException(
        'La configuración de la empresa no está completa.',
      );
    const cufe = request.cufe.trim().toLowerCase();
    const eventId = request.eventId as 1 | 2 | 3 | 4;
    if (eventId === 2) {
      if (
        !Number.isInteger(request.typeRejectionId) ||
        (request.typeRejectionId ?? 0) <= 0
      )
        throw new BadRequestException(
          'Selecciona un motivo de reclamo válido.',
        );
      const reasons = await this.client.fetchMasterTable(
        'type_rejections',
        token,
      );
      if (
        !reasons.some((reason) => Number(reason.id) === request.typeRejectionId)
      )
        throw new BadRequestException('El motivo de reclamo no es válido.');
    }
    const claim = await this.events.claim(
      companyId,
      cufe,
      eventId,
      eventId === 2 ? request.typeRejectionId! : null,
    );
    if (!claim.claimed) {
      if (claim.row.status !== 'sent' && claim.row.cude) {
        const confirmed = await this.client.getRadianEventStatus(claim.row.cude, token);
        await this.events.complete(claim.row, confirmed);
        const { response, ...visible } = confirmed;
        return visible;
      }
      return {
        ...this.publicResult(claim.row),
        ...(claim.row.status !== 'sent' && !claim.row.cude ? {
          message: 'El proveedor no devolvio una confirmacion ni un CUDE. Comparte el CUFE con soporte para recuperar el resultado del envio.',
        } : {}),
      };
    }
    let result: RadianEventResult;
    try {
      result = await this.client.sendRadianEvent(
        {
          event_id: eventId,
          type_rejection_id: eventId === 2 ? request.typeRejectionId! : null,
          document_reference: { cufe },
        },
        token,
      );
    } catch {
      result = {
        status: 'unknown',
        message:
          'El envío no pudo confirmarse. Consulta el estado antes de reenviar.',
      };
    }
    await this.events.complete(claim.row, result);
    if (result.status === 'unknown' && result.cude) {
      const confirmed = await this.client.getRadianEventStatus(
        result.cude,
        token,
      );
      await this.events.complete(claim.row, confirmed);
      result = confirmed;
    }
    const { response, ...visible } = result;
    return visible;
  }

  private publicResult(row: JarvisRadianEvent) {
    return {
      status: row.status === 'processing' ? ('unknown' as const) : row.status,
      ...(row.cude ? { cude: row.cude } : {}),
      ...(row.dianCode ? { dianCode: row.dianCode } : {}),
      ...(row.message ? { message: row.message } : {}),
    };
  }

  async listInvoices(companyId: string, cursor = '') {
    if (cursor && !/^[a-f0-9]{96}$/.test(cursor)) throw new BadRequestException('El cursor no es válido.');
    const rows: Array<{ cufe: string; eventId: number; status: JarvisRadianEvent['status']; cude: string | null; dianCode: string | null; message: string | null; typeRejectionId: number | null; updatedAt: Date; number: string | null; supplier: string | null; nit: string | null; date: string | null }> = await this.events.listInvoices(companyId, cursor);
    const grouped = new Map<string, { cufe: string; number: string; supplier: string; nit: string; date: string; valid: boolean; events: Array<{ eventId: number; status: 'sent' | 'failed' | 'unknown'; cude: string | null; dianCode: string | null; message: string | null; typeRejectionId: number | null; updatedAt: Date }> }>();
    for (const row of rows) {
      let invoice = grouped.get(row.cufe);
      if (!invoice) { invoice = { cufe: row.cufe, number: '', supplier: '', nit: '', date: '', valid: true, events: [] }; grouped.set(row.cufe, invoice); }
      invoice.number ||= row.number || '';
      invoice.supplier ||= row.supplier || '';
      invoice.nit ||= row.nit || '';
      invoice.date ||= row.date?.slice(0, 10) || '';
      invoice.events.push({ eventId: row.eventId, status: row.status === 'processing' ? 'unknown' : row.status, cude: row.cude, dianCode: row.dianCode, message: row.message, typeRejectionId: row.typeRejectionId, updatedAt: row.updatedAt });
    }
    const items = [...grouped.values()];
    return { items: items.slice(0, 100), nextCursor: items.length > 100 ? items[99].cufe : null };
  }

  async history(companyId: string, cufe: string) {
    if (typeof cufe !== 'string' || !/^[a-f0-9]{96}$/i.test(cufe.trim()))
      throw new BadRequestException('El CUFE no es válido.');
    const company = await this.companies.findById(companyId);
    if (!company) throw new BadRequestException('Empresa no encontrada.');
    const rows = await this.events.list(companyId, cufe.trim().toLowerCase());
    return {
      events: rows.map((row) => ({
        eventId: row.eventId,
        typeRejectionId: row.rejectionId,
        ...this.publicResult(row),
        updatedAt: row.updatedAt,
      })),
    };
  }
}
