import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
import { IntegrationLogoService } from '../integration-logo.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';
import { JarvisResolutionKind } from './enums/jarvis-resolution-kind.enum';

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
  constructor(@InjectRepository(JarvisSalesInvoice) private readonly invoices: Repository<JarvisSalesInvoice>, private readonly companies: CompaniesRepository, private readonly nextPyme: NextPymeApiClient, private readonly logos: IntegrationLogoService) {}
  async getData(companyId: string, id: string) {
    const invoice = await this.invoices.createQueryBuilder('invoice').addSelect('invoice.invoiceXml')
      .where('invoice.companyId = :companyId', { companyId })
      .andWhere('invoice.id = :id', { id }).getOne();
    if (!invoice) throw new NotFoundException('No se encontró el documento.');
    const code = uniqueCodeLabel(invoice.documentKind);
    if (!invoice.cufe) throw new BadGatewayException(`El documento aún no tiene ${code} disponible. No vuelvas a emitirlo; actualiza el listado e intenta visualizarlo después.`);
    const logo = await this.logos.get(companyId, IntegrationProvider.JARVIS);
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
}
