import { normalizeInvoiceAppearance } from './pdf/invoice-appearance';
import { BadRequestException, BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { IntegrationLogoService } from '../integration-logo.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { issuedItemName } from './helpers/jarvis-issued-snapshot.helper';
import { attachmentMetadata } from './helpers/jarvis-invoice-attachment.helper';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import type { JarvisInvoicePdfData } from './pdf/jarvis-invoice-pdf-data';
import {
  hasIssuedPdfFallback,
  mapJarvisIssuedDocumentToPdfData,
} from './pdf/map-jarvis-issued-document-to-pdf-data';
import { renderJarvisInvoicePdfBase64 } from './pdf/sales-invoice-pdf.renderer';
import { buildJarvisDocumentEmail } from './helpers/jarvis-document-email.helper';
import { randomUUID } from 'node:crypto';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';
import { issuerTaxProfile } from './helpers/jarvis-issuer-tax-profile.helper';
import { storedPurchaseOrderReference } from './helpers/jarvis-purchase-order.helper';
import type { JarvisPurchaseOrderDto } from './dto/create-jarvis-invoice.dto';

function withPurchaseOrder(data: JarvisInvoicePdfData, kind?: string | null, order?: JarvisPurchaseOrderDto | null): JarvisInvoicePdfData {
  if (kind !== JarvisResolutionKind.ELECTRONIC_INVOICE) return data;
  const saved = storedPurchaseOrderReference(order);
  if (!saved) return data;
  const number = data.orderNumber?.trim();
  return {
    ...data,
    orderNumber: number || saved.orderNumber,
    orderDate: data.orderDate?.trim() || (!number || number === saved.orderNumber ? saved.orderDate : null),
  };
}

function uniqueCodeLabel(kind?: string | null) {
  if (
    kind === JarvisResolutionKind.SUPPORT_DOCUMENT ||
    kind === JarvisResolutionKind.SUPPORT_CREDIT_NOTE
  ) {
    return 'CUDS';
  }
  if (
    kind === JarvisResolutionKind.CREDIT_NOTE ||
    kind === JarvisResolutionKind.DEBIT_NOTE
  ) {
    return 'CUDE';
  }
  return 'CUFE';
}

@Injectable()
export class JarvisInvoicePdfService {
  private readonly logger = new Logger(JarvisInvoicePdfService.name);

  constructor(
    @InjectRepository(JarvisSalesInvoice) private readonly invoices: Repository<JarvisSalesInvoice>,
    private readonly companies: CompaniesRepository,
    private readonly nextPyme: NextPymeApiClient,
    private readonly logos: IntegrationLogoService,
    private readonly integrations: IntegrationsRepository,
  ) {}

  async sendEmail(companyId: string, id: string, request: { recipientEmail?: string; additionalEmails?: string[]; message?: string }) {
    const trace = { requestId: randomUUID(), companyId, documentId: id };
    return this.traceEmailStep(trace, 'reenvio', () => this.performSendEmail(companyId, id, request, trace));
  }

  private async traceEmailStep<T>(trace: Record<string, string>, step: string, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    console.log('[document-email] antes', { ...trace, step });
    try {
      const result = await work();
      console.log('[document-email] despues', { ...trace, step, elapsedMs: Date.now() - started });
      return result;
    } catch (error) {
      // Do not log request objects, tokens, recipients or the base64 PDF.
      console.error('[document-email] error', {
        ...trace, step, elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'Error no identificado',
      });
      throw error;
    }
  }

  private async performSendEmail(companyId: string, id: string, request: { recipientEmail?: string; additionalEmails?: string[]; message?: string }, trace: Record<string, string>) {
    if (!request || (request.recipientEmail !== undefined && (typeof request.recipientEmail !== 'string' || (request.recipientEmail.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.recipientEmail.trim())))) || (request.additionalEmails !== undefined && (!Array.isArray(request.additionalEmails) || request.additionalEmails.length > 50)) || (request.message !== undefined && (typeof request.message !== 'string' || request.message.length > 500))) {
      throw new BadRequestException('Los correos adicionales o el mensaje no son válidos.');
    }
    const extras = request.additionalEmails ?? [];
    if (extras.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      throw new BadRequestException('Revisa los correos adicionales.');
    }
    const invoice = await this.traceEmailStep(trace, 'consultar-documento', () => this.invoices.findOne({ where: { companyId, id } }));
    if (!invoice) throw new NotFoundException('No se encontró el documento.');
    const data = await this.traceEmailStep(trace, 'consultar-datos-pdf', () => this.getData(companyId, id));
    const recipient = request.recipientEmail === undefined ? data.buyer.email : request.recipientEmail;
    const emails = [...new Set([recipient, ...(data.recipientCopyEmails ?? []), ...extras].filter((email): email is string => Boolean(email?.trim())).map(email => email.trim().toLowerCase()))];
    if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException('Se requiere al menos un correo válido.');
    const company = await this.traceEmailStep(trace, 'consultar-empresa', () => this.companies.findById(companyId));
    if (!company?.nextPymeToken) throw new BadRequestException('La empresa no tiene un token de correo configurado.');
    const graphic = await this.traceEmailStep(trace, 'generar-pdf', () => renderJarvisInvoicePdfBase64(data));
    const message = request.message?.trim() ?? '';
    const html = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r?\n/g, '<br>');
    const template = buildJarvisDocumentEmail({
      issuerName: data.issuer.name || company.name || '',
      issuerNit: data.issuer.documentNumber || company.nit || '',
      receiverName: data.buyer.name || '',
      documentNumber: data.invoiceNumber || (invoice.number.startsWith(invoice.prefix) ? invoice.number : `${invoice.prefix}${invoice.number}`),
      issueDate: data.issueDate || '',
      total: data.total,
      currency: data.currency,
      documentKind: data.documentKind,
      cufe: data.cufe,
    });
    if (html) {
      template.html_body += `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:760px;margin:0 auto;border-collapse:collapse;font-family:Arial,sans-serif;"><tr><td style="padding:4px 12px;font-size:12px;"><p style="margin:0;">${html}</p></td></tr></table>`;
    }
    const response = await this.traceEmailStep(trace, 'servicio-reenvio-correo', () => this.nextPyme.sendDocumentEmail({
      prefix: invoice.prefix,
      number: invoice.number.startsWith(invoice.prefix) ? invoice.number.slice(invoice.prefix.length) : invoice.number,
      alternate_email: emails[0],
      email_cc_list: emails.slice(1).map(email => ({ email })),
      send_email_cc_list_as_email_cc: emails.length > 1,
      base64graphicrepresentation: graphic,
      showacceptrejectbuttons: false,
      ...template,
    }, company.nextPymeToken!));
    if (response.success === false) throw new BadGatewayException('El proveedor no confirmó el envío del correo.');
    const delivery = await this.recordEmailDelivery(companyId, id, emails);
    return { success: true, delivery };
  }

  async downloadInvoiceXml(companyId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const invoice = await this.invoices.findOne({ where: { companyId, id, documentKind: JarvisResolutionKind.ELECTRONIC_INVOICE } });
    if (!invoice) throw new NotFoundException('No se encontró la factura.');
    if (!invoice.cufe) throw new BadGatewayException('La factura aún no tiene CUFE disponible.');
    const company = await this.companies.findById(companyId);
    const nit = company?.nit?.replace(/[.\s]/g, '').replace(/-\d$/, '') ?? '';
    const token = company?.nextPymeToken?.trim();
    const number = invoice.number.startsWith(invoice.prefix) ? invoice.number : `${invoice.prefix}${invoice.number}`;
    if (!/^\d+$/.test(nit) || !token || !/^[a-zA-Z0-9]+$/.test(number)) {
      throw new BadRequestException('No se pudo determinar el NIT, token o número para descargar el XML.');
    }
    const filename = `FES-${number}.xml`;
    const buffer = await this.nextPyme.downloadInvoiceXml(nit, filename, token);
    mapInvoiceXmlToPurchaseInvoiceDownload(buffer.toString('utf8'), id, invoice.cufe);
    return { buffer, filename };
  }

  async recordEmailDelivery(companyId: string, id: string, recipients: string[]) {
    const delivery = { recipients: [...new Set(recipients.map(email => email.trim().toLowerCase()).filter(Boolean))], sentAt: new Date().toISOString() };
    if (!delivery.recipients.length) return undefined;
    try {
      // Append atomically so concurrent resends preserve both records.
      await this.invoices.query(
        `UPDATE jarvis_sales_invoices
         SET source_request = jsonb_set(COALESCE(source_request, '{}'::jsonb), '{emailDeliveries}',
           COALESCE(source_request->'emailDeliveries', '[]'::jsonb) || $3::jsonb)
         WHERE company_id=$1 AND id=$2`,
        [companyId, id, JSON.stringify([delivery])],
      );
      return delivery;
    } catch {
      // The provider already accepted the email; a log failure must not trigger another send.
      this.logger.warn(`[companyId=${companyId}] No se pudo guardar el registro de envío de correo del documento ${id}.`);
      return undefined;
    }
  }

  async getData(companyId: string, id: string): Promise<JarvisInvoicePdfData> {
    const invoice = await this.invoices.createQueryBuilder('invoice')
      .addSelect('invoice.invoiceXml')
      .addSelect('invoice.sourceRequest')
      .where('invoice.companyId = :companyId', { companyId })
      .andWhere('invoice.id = :id', { id }).getOne();
    if (!invoice) throw new NotFoundException('No se encontró el documento.');
    const code = uniqueCodeLabel(invoice.documentKind);
    if (!invoice.cufe) throw new BadGatewayException(`El documento aún no tiene ${code} disponible. No vuelvas a emitirlo; actualiza el listado e intenta visualizarlo después.`);
    const presentation = await this.loadPdfPresentation(companyId, invoice.documentKind);
    const logo = await this.safeLogo(companyId);
    const withKind = { emailDeliveries: invoice.sourceRequest?.emailDeliveries ?? [], documentKind: invoice.documentKind, recipientCopyEmails: invoice.sourceRequest?.recipientCopyEmails ?? [], sellers: invoice.sourceRequest?.sellers ?? [], paymentBreakdown: invoice.sourceRequest?.paymentBreakdown, attachment: attachmentMetadata(invoice.sourceRequest?.attachment), ...logo };
    const withMetadata = (data: JarvisInvoicePdfData) => ({
      ...withPurchaseOrder(data, invoice.documentKind, invoice.sourceRequest?.purchaseOrder), ...withKind,
      ...presentation,
      items: data.items.map((item, index) => ({ ...item,
        name: item.name?.trim() && item.name.trim() !== item.code?.trim() ? item.name
          : issuedItemName(invoice.sourceRequest?.emissionSnapshot, index, item) || item.name,
      })),
    });
    if (invoice.invoiceXml) {
      try { return withMetadata(mapInvoiceXmlToPurchaseInvoiceDownload(invoice.invoiceXml, id, invoice.cufe)); } catch { /* An emission envelope can contain an incomplete XML; recover the DIAN copy. */ }
    }
    try {
      const company = await this.companies.findById(companyId);
      const xml = await this.nextPyme.getInvoiceXmlByCufe(invoice.cufe, company?.nextPymeToken ?? '');
      const data = mapInvoiceXmlToPurchaseInvoiceDownload(xml, id, invoice.cufe);
      await this.invoices.update({ id, companyId }, { invoiceXml: xml });
      return withMetadata(data);
    } catch (error) {
      const fallback = this.fallbackFromIssuedDocument(invoice);
      if (fallback) {
        this.logger.warn(
          `[companyId=${companyId}] PDF de ${invoice.documentKind} ${invoice.prefix}${invoice.number} sin XML de NextPyme; se usan los datos emitidos. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return withMetadata(fallback);
      }
      throw error;
    }
  }

  /**
   * PDF JARVIS (el mismo del visor) en base64, para NextPyme
   * `base64graphicrepresentation`. Si no se puede armar, devuelve vacío:
   * el correo igual debe salir.
   */
  async renderGraphicBase64(input: {
    companyId: string;
    historyId?: string;
    invoiceXml?: string | null;
    cufe?: string | null;
    documentKind?: string | null;
    token?: string;
    purchaseOrder?: JarvisPurchaseOrderDto;
  }): Promise<string> {
    try {
      const data = await this.buildPdfData(input);
      if (!data?.dianQrText) return '';
      const { sellers: _internalSellers, ...emailData } = data;
      return await renderJarvisInvoicePdfBase64(emailData);
    } catch (error) {
      this.logger.warn(
        `[companyId=${input.companyId}] No se pudo generar el PDF JARVIS para el correo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return '';
    }
  }

  private async buildPdfData(input: {
    companyId: string;
    historyId?: string;
    invoiceXml?: string | null;
    cufe?: string | null;
    documentKind?: string | null;
    token?: string;
    purchaseOrder?: JarvisPurchaseOrderDto;
  }): Promise<JarvisInvoicePdfData | null> {
    if (input.historyId) return this.getData(input.companyId, input.historyId);
    const logo = await this.safeLogo(input.companyId);
    const presentation = await this.loadPdfPresentation(input.companyId, input.documentKind);
    const withKind = { documentKind: input.documentKind ?? null, ...presentation, ...logo };
    if (input.invoiceXml && input.cufe) {
      try {
        return {
          ...withPurchaseOrder(mapInvoiceXmlToPurchaseInvoiceDownload(
            input.invoiceXml,
            input.historyId || 'issued',
            input.cufe,
          ), input.documentKind, input.purchaseOrder),
          ...withKind,
        };
      } catch {
        /* Recover XML from NextPyme below. */
      }
    }
    if (input.cufe && input.token) {
      try {
        const xml = await this.nextPyme.getInvoiceXmlByCufe(input.cufe, input.token);
        return {
          ...withPurchaseOrder(mapInvoiceXmlToPurchaseInvoiceDownload(xml, 'issued', input.cufe), input.documentKind, input.purchaseOrder),
          ...withKind,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  private fallbackFromIssuedDocument(
    invoice: JarvisSalesInvoice,
  ): JarvisInvoicePdfData | null {
    if (!hasIssuedPdfFallback(invoice)) {
      return null;
    }
    return mapJarvisIssuedDocumentToPdfData(invoice);
  }

  private async loadPdfPresentation(companyId: string, kind?: string | null): Promise<Pick<JarvisInvoicePdfData, 'issuerTaxProfile' | 'invoiceAppearance'>> {
    const integration = await this.integrations.findByCompanyAndProvider(companyId, IntegrationProvider.JARVIS);
    if (!integration) return {};
    const credentials = normalizeJarvisCredentials(integration.credentials);
    return {
      issuerTaxProfile: issuerTaxProfile(credentials, 'current'),
      ...(!kind || kind === JarvisResolutionKind.ELECTRONIC_INVOICE
        ? { invoiceAppearance: normalizeInvoiceAppearance(credentials.invoice_appearance) } : {}),
    };
  }

  private async safeLogo(companyId: string): Promise<{ logoDataUrl: string | null }> {
    try {
      return await this.logos.get(companyId, IntegrationProvider.JARVIS);
    } catch {
      return { logoDataUrl: null };
    }
  }
}
