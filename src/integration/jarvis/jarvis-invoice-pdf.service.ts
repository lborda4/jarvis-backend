import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { IntegrationLogoService } from '../integration-logo.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';
import type { JarvisInvoicePdfData } from './pdf/jarvis-invoice-pdf-data';
import { renderJarvisInvoicePdfBase64 } from './pdf/sales-invoice-pdf.renderer';

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
  ) {}

  async getData(companyId: string, id: string): Promise<JarvisInvoicePdfData> {
    const invoice = await this.invoices.createQueryBuilder('invoice').addSelect('invoice.invoiceXml')
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
    const company = await this.companies.findById(companyId);
    const xml = await this.nextPyme.getInvoiceXmlByCufe(invoice.cufe, company?.nextPymeToken ?? '');
    const data = mapInvoiceXmlToPurchaseInvoiceDownload(xml, id, invoice.cufe);
    await this.invoices.update({ id, companyId }, { invoiceXml: xml });
    return { ...data, ...withKind };
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
      const xml = await this.nextPyme.getInvoiceXmlByCufe(input.cufe, input.token);
      return {
        ...mapInvoiceXmlToPurchaseInvoiceDownload(xml, 'issued', input.cufe),
        ...withKind,
      };
    }
    return null;
  }

  private async safeLogo(companyId: string): Promise<{ logoDataUrl: string | null }> {
    try {
      return await this.logos.get(companyId, IntegrationProvider.JARVIS);
    } catch {
      return { logoDataUrl: null };
    }
  }
}
