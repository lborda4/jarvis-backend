import { BadRequestException, BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { IntegrationLogoService } from '../integration-logo.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { normalizeJarvisCredentials } from './helpers/jarvis-credentials.helper';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import type { JarvisInvoicePdfData } from './pdf/jarvis-invoice-pdf-data';
import {
  hasIssuedPdfFallback,
  mapJarvisIssuedDocumentToPdfData,
} from './pdf/map-jarvis-issued-document-to-pdf-data';
import { renderJarvisInvoicePdfBase64 } from './pdf/sales-invoice-pdf.renderer';
import { buildJarvisDocumentEmail } from './helpers/jarvis-document-email.helper';

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

  async sendEmail(companyId: string, id: string, request: { additionalEmails?: string[]; message?: string }) {
    if (!request || (request.additionalEmails !== undefined && (!Array.isArray(request.additionalEmails) || request.additionalEmails.length > 50)) || (request.message !== undefined && (typeof request.message !== 'string' || request.message.length > 500))) {
      throw new BadRequestException('Los correos adicionales o el mensaje no son válidos.');
    }
    const extras = request.additionalEmails ?? [];
    if (extras.some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
      throw new BadRequestException('Revisa los correos adicionales.');
    }
    const invoice = await this.invoices.findOne({ where: { companyId, id } });
    if (!invoice) throw new NotFoundException('No se encontró el documento.');
    const data = await this.getData(companyId, id);
    const registered = data.buyer.email?.trim().toLowerCase();
    const emails = [...new Set([registered, ...extras.map(email => email.trim().toLowerCase())].filter((email): email is string => Boolean(email)))];
    if (!emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BadRequestException('Se requiere al menos un correo válido.');
    const company = await this.companies.findById(companyId);
    if (!company?.nextPymeToken) throw new BadRequestException('La empresa no tiene un token de correo configurado.');
    const graphic = await renderJarvisInvoicePdfBase64(data);
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
    const response = await this.nextPyme.sendDocumentEmail({
      prefix: invoice.prefix,
      number: invoice.number.startsWith(invoice.prefix) ? invoice.number.slice(invoice.prefix.length) : invoice.number,
      alternate_email: emails[0],
      email_cc_list: emails.slice(1).map(email => ({ email })),
      send_email_cc_list_as_email_cc: emails.length > 1,
      base64graphicrepresentation: graphic,
      showacceptrejectbuttons: false,
      ...template,
    }, company.nextPymeToken);
    if (response.success === false) throw new BadGatewayException('El proveedor no confirmó el envío del correo.');
    return { success: true };
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
    const logo = await this.safeLogo(companyId);
    const withKind = { documentKind: invoice.documentKind, ...logo };
    if (invoice.invoiceXml) {
      try { return { ...mapInvoiceXmlToPurchaseInvoiceDownload(invoice.invoiceXml, id, invoice.cufe), ...withKind }; } catch { /* An emission envelope can contain an incomplete XML; recover the DIAN copy. */ }
    }
    try {
      const company = await this.companies.findById(companyId);
      const xml = await this.nextPyme.getInvoiceXmlByCufe(invoice.cufe, company?.nextPymeToken ?? '');
      const data = mapInvoiceXmlToPurchaseInvoiceDownload(xml, id, invoice.cufe);
      await this.invoices.update({ id, companyId }, { invoiceXml: xml });
      return { ...data, ...withKind };
    } catch (error) {
      const fallback = await this.fallbackFromIssuedDocument(invoice, companyId);
      if (fallback) {
        this.logger.warn(
          `[companyId=${companyId}] PDF de ${invoice.documentKind} ${invoice.prefix}${invoice.number} sin XML de NextPyme; se usan los datos emitidos. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return { ...fallback, ...withKind };
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
  }): Promise<string> {
    try {
      const data = await this.buildPdfData(input);
      if (!data?.dianQrText) return '';
      return await renderJarvisInvoicePdfBase64(data);
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
  }): Promise<JarvisInvoicePdfData | null> {
    const logo = await this.safeLogo(input.companyId);
    const withKind = { documentKind: input.documentKind ?? null, ...logo };
    if (input.invoiceXml && input.cufe) {
      try {
        return {
          ...mapInvoiceXmlToPurchaseInvoiceDownload(
            input.invoiceXml,
            input.historyId || 'issued',
            input.cufe,
          ),
          ...withKind,
        };
      } catch {
        /* Recover XML from NextPyme below. */
      }
    }
    if (input.historyId) {
      return this.getData(input.companyId, input.historyId);
    }
    if (input.cufe && input.token) {
      try {
        const xml = await this.nextPyme.getInvoiceXmlByCufe(input.cufe, input.token);
        return {
          ...mapInvoiceXmlToPurchaseInvoiceDownload(xml, 'issued', input.cufe),
          ...withKind,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  private async fallbackFromIssuedDocument(
    invoice: JarvisSalesInvoice,
    companyId: string,
  ): Promise<JarvisInvoicePdfData | null> {
    if (!hasIssuedPdfFallback(invoice)) {
      return null;
    }
    const integration = await this.integrations.findByCompanyAndProvider(
      companyId,
      IntegrationProvider.JARVIS,
    );
    const company = await this.companies.findById(companyId);
    return mapJarvisIssuedDocumentToPdfData(
      invoice,
      normalizeJarvisCredentials(integration?.credentials ?? {}),
      company,
    );
  }

  private async safeLogo(companyId: string): Promise<{ logoDataUrl: string | null }> {
    try {
      return await this.logos.get(companyId, IntegrationProvider.JARVIS);
    } catch {
      return { logoDataUrl: null };
    }
  }
}
