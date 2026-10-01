import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';
import { JarvisSalesInvoice } from './entities/jarvis-sales-invoice.entity';
import { NextPymeApiClient } from './nextpyme/nextpyme-api.client';
@Injectable()
export class JarvisInvoicePdfService {
  constructor(@InjectRepository(JarvisSalesInvoice) private readonly invoices: Repository<JarvisSalesInvoice>, private readonly companies: CompaniesRepository, private readonly nextPyme: NextPymeApiClient) {}
  async getData(companyId: string, id: string) {
    const invoice = await this.invoices.createQueryBuilder('invoice').addSelect('invoice.invoiceXml')
      .where('invoice.companyId = :companyId', { companyId })
      .andWhere('invoice.id = :id', { id }).andWhere('invoice.documentKind = :kind', { kind: 'ELECTRONIC_INVOICE' }).getOne();
    if (!invoice) throw new NotFoundException('No se encontró la factura.');
    if (!invoice.cufe) throw new BadGatewayException('La factura aún no tiene CUFE disponible. No vuelvas a emitirla; actualiza el listado e intenta visualizarla después.');
    if (invoice.invoiceXml) {
      try { return mapInvoiceXmlToPurchaseInvoiceDownload(invoice.invoiceXml, id, invoice.cufe); } catch { /* An emission envelope can contain an incomplete XML; recover the DIAN copy. */ }
    }
    const company = await this.companies.findById(companyId);
    const xml = await this.nextPyme.getInvoiceXmlByCufe(invoice.cufe, company?.nextPymeToken ?? '');
    const data = mapInvoiceXmlToPurchaseInvoiceDownload(xml, id, invoice.cufe);
    await this.invoices.update({ id, companyId }, { invoiceXml: xml });
    return data;
  }
}
