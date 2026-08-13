import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import {
  DianInvoiceItem,
  DianInvoiceResult,
} from './interfaces/dian-invoice-result.interface';
import { matchIsoDate } from '../common/helpers/date-normalization.helper';

type XmlValue = string | number | boolean | XmlObject | XmlValue[];
type XmlObject = { [key: string]: XmlValue | undefined };

const INVOICE_ROOT_KEYS = ['Invoice', 'CreditNote', 'DebitNote'] as const;

const EMBEDDED_DOCUMENT_PATTERNS: Array<{
  open: RegExp;
  close: string;
}> = [
  { open: /<Invoice\b[^>]*>/i, close: '</Invoice>' },
  { open: /<CreditNote\b[^>]*>/i, close: '</CreditNote>' },
  { open: /<DebitNote\b[^>]*>/i, close: '</DebitNote>' },
];

@Injectable()
export class DianParserService {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
    parseTagValue: true,
    parseAttributeValue: true,
  });

  parseInvoiceXml(xmlContent: string, cufe?: string): DianInvoiceResult {
    const invoiceXml = this.extractInvoiceXmlContent(xmlContent);
    const parsed = this.parser.parse(invoiceXml) as XmlObject;
    const document = this.findInvoiceDocument(parsed);

    if (!document) {
      const rootElement = this.getRootElementKey(parsed);

      if (rootElement === 'ApplicationResponse') {
        throw new Error(
          'El XML es un ApplicationResponse de la DIAN (acuse o recibo), no una factura. Envíe el archivo Invoice/FV*.xml con el elemento raíz <Invoice>.',
        );
      }

      if (rootElement === 'AttachedDocument') {
        throw new Error(
          'El XML es un AttachedDocument sin una factura embebida legible. Verifique que el archivo incluya el bloque <Invoice>.',
        );
      }

      throw new Error(
        `No se encontró un documento de factura válido en el XML (elemento raíz detectado: ${rootElement ?? 'desconocido'}).`,
      );
    }

    const resolvedCufe =
      cufe?.trim() ||
      this.getText(document, 'UUID') ||
      this.extractCufeFromRawXml(invoiceXml);

    if (!resolvedCufe) {
      throw new Error('No se encontró el CUFE/UUID en el XML.');
    }

    const supplierParty = this.getValue<XmlObject>(
      document,
      'AccountingSupplierParty.Party',
    );
    const customerParty = this.getValue<XmlObject>(
      document,
      'AccountingCustomerParty.Party',
    );
    const monetaryTotal = this.getValue<XmlObject>(
      document,
      'LegalMonetaryTotal',
    );
    const taxTotal = this.getValue<XmlObject>(document, 'TaxTotal');

    return {
      cufe: resolvedCufe,
      numeroFactura: this.getText(document, 'ID'),
      fechaEmision: this.normalizeInvoiceDate(this.getText(document, 'IssueDate')),
      fechaVencimiento: this.getInvoiceDueDate(document),
      moneda: this.getText(document, 'DocumentCurrencyCode'),
      emisor: {
        nit: this.getPartyNit(supplierParty),
        nombre: this.getPartyName(supplierParty),
        tipoDocumento: this.getPartyDocumentType(supplierParty),
        direccion: this.getPartyAddress(supplierParty),
        telefono: this.getPartyPhone(supplierParty),
        email: this.getPartyEmail(supplierParty),
        codigoDepartamento: this.getPartyStateCode(supplierParty),
        codigoCiudad: this.getPartyCityCode(supplierParty),
        codigoPais: this.getPartyCountryCode(supplierParty),
        codigoPostal: this.getPartyPostalCode(supplierParty),
      },
      receptor: {
        nit: this.getPartyNit(customerParty),
        nombre: this.getPartyName(customerParty),
      },
      items: this.parseItems(document),
      totales: {
        subtotal: this.getAmount(monetaryTotal, 'LineExtensionAmount'),
        total: this.getAmount(monetaryTotal, 'PayableAmount'),
        iva: this.getAmount(taxTotal, 'TaxAmount'),
      },
    };
  }

  private findInvoiceDocument(parsed: XmlObject): XmlObject | null {
    const atRoot = this.findInvoiceDocumentAtRoot(parsed);
    if (atRoot) {
      return atRoot;
    }

    const deep = this.findInvoiceDocumentDeep(parsed);
    if (deep) {
      return deep;
    }

    return this.findInvoiceDocumentInEmbeddedXml(parsed);
  }

  private findInvoiceDocumentAtRoot(parsed: XmlObject): XmlObject | null {
    for (const key of INVOICE_ROOT_KEYS) {
      const document = parsed[key];
      if (document && typeof document === 'object' && !Array.isArray(document)) {
        return document as XmlObject;
      }
    }

    return null;
  }

  private findInvoiceDocumentDeep(
    node: XmlValue,
    depth = 0,
  ): XmlObject | null {
    if (depth > 25 || node === null || node === undefined) {
      return null;
    }

    if (typeof node === 'object') {
      if (!Array.isArray(node)) {
        for (const key of INVOICE_ROOT_KEYS) {
          const document = (node as XmlObject)[key];
          if (
            document &&
            typeof document === 'object' &&
            !Array.isArray(document)
          ) {
            return document as XmlObject;
          }
        }
      }

      const children = Array.isArray(node)
        ? node
        : Object.values(node as XmlObject);

      for (const child of children) {
        if (child === undefined) {
          continue;
        }

        const found = this.findInvoiceDocumentDeep(child, depth + 1);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  private findInvoiceDocumentInEmbeddedXml(
    node: XmlValue,
    depth = 0,
  ): XmlObject | null {
    if (depth > 25 || node === null || node === undefined) {
      return null;
    }

    if (typeof node === 'string') {
      const embeddedXml = this.extractInvoiceXmlContent(node);
      if (embeddedXml === node.trim()) {
        return null;
      }

      try {
        const nested = this.parser.parse(embeddedXml) as XmlObject;
        const document =
          this.findInvoiceDocumentAtRoot(nested) ||
          this.findInvoiceDocumentDeep(nested);

        if (document) {
          return document;
        }
      } catch {
        return null;
      }

      return null;
    }

    if (typeof node === 'object') {
      if (!Array.isArray(node) && '#text' in node) {
        const textValue = node['#text'];
        if (textValue !== undefined) {
          const fromText = this.findInvoiceDocumentInEmbeddedXml(
            textValue,
            depth + 1,
          );
          if (fromText) {
            return fromText;
          }
        }
      }

      const children = Array.isArray(node)
        ? node
        : Object.values(node as XmlObject);

      for (const child of children) {
        if (child === undefined) {
          continue;
        }

        const found = this.findInvoiceDocumentInEmbeddedXml(child, depth + 1);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  private extractInvoiceXmlContent(xmlContent: string): string {
    const trimmed = xmlContent.trim();

    if (this.isInvoiceRootDocument(trimmed)) {
      return trimmed;
    }

    for (const pattern of EMBEDDED_DOCUMENT_PATTERNS) {
      const match = pattern.open.exec(trimmed);
      if (!match) {
        continue;
      }

      const startIndex = match.index;
      const endIndex = trimmed.indexOf(pattern.close, startIndex);

      if (endIndex === -1) {
        continue;
      }

      return trimmed.slice(
        startIndex,
        endIndex + pattern.close.length,
      );
    }

    return trimmed;
  }

  private isInvoiceRootDocument(xmlContent: string): boolean {
    const withoutProlog = xmlContent.replace(/^<\?xml[^>]*\?>\s*/i, '').trim();

    return EMBEDDED_DOCUMENT_PATTERNS.some((pattern) =>
      pattern.open.test(withoutProlog),
    );
  }

  private extractCufeFromRawXml(xmlContent: string): string {
    const match = xmlContent.match(
      /<UUID[^>]*schemeName="CUFE[^"]*"[^>]*>([^<]+)<\/UUID>/i,
    );

    return match?.[1]?.trim() ?? '';
  }

  private getRootElementKey(parsed: XmlObject): string | null {
    const rootKeys = Object.keys(parsed).filter((key) => key !== '?xml');
    return rootKeys[0] ?? null;
  }

  private parseItems(document: XmlObject): DianInvoiceItem[] {
    const invoiceLines = this.toArray(
      this.getValue<XmlObject | XmlObject[]>(document, 'InvoiceLine'),
    );

    if (invoiceLines.length > 0) {
      return invoiceLines.map((line) => this.mapInvoiceLine(line));
    }

    const creditNoteLines = this.toArray(
      this.getValue<XmlObject | XmlObject[]>(document, 'CreditNoteLine'),
    );

    if (creditNoteLines.length > 0) {
      return creditNoteLines.map((line) => this.mapCreditNoteLine(line));
    }

    const debitNoteLines = this.toArray(
      this.getValue<XmlObject | XmlObject[]>(document, 'DebitNoteLine'),
    );

    return debitNoteLines.map((line) => this.mapDebitNoteLine(line));
  }

  private mapInvoiceLine(line: XmlObject): DianInvoiceItem {
    return {
      descripcion: this.getText(line, 'Item.Description'),
      cantidad: this.getAmount(line, 'InvoicedQuantity'),
      valorUnitario: this.getAmount(line, 'Price.PriceAmount'),
      total: this.getAmount(line, 'LineExtensionAmount'),
    };
  }

  private mapCreditNoteLine(line: XmlObject): DianInvoiceItem {
    return {
      descripcion: this.getText(line, 'Item.Description'),
      cantidad: this.getAmount(line, 'CreditedQuantity'),
      valorUnitario: this.getAmount(line, 'Price.PriceAmount'),
      total: this.getAmount(line, 'LineExtensionAmount'),
    };
  }

  private mapDebitNoteLine(line: XmlObject): DianInvoiceItem {
    return {
      descripcion: this.getText(line, 'Item.Description'),
      cantidad: this.getAmount(line, 'DebitedQuantity'),
      valorUnitario: this.getAmount(line, 'Price.PriceAmount'),
      total: this.getAmount(line, 'LineExtensionAmount'),
    };
  }

  private getPartyNit(party: XmlObject | null): string {
    if (!party) {
      return '';
    }

    return (
      this.getText(party, 'PartyTaxScheme.CompanyID') ||
      this.getText(party, 'PartyIdentification.ID')
    );
  }

  private getPartyDocumentType(party: XmlObject | null): string {
    if (!party) {
      return 'NIT';
    }

    const taxSchemes = this.toArray(
      party.PartyTaxScheme as XmlObject | XmlObject[] | undefined,
    );

    for (const taxScheme of taxSchemes) {
      const schemeType = this.resolveDocumentTypeFromNode(
        this.getValue<XmlObject>(taxScheme, 'CompanyID'),
      );
      if (schemeType) {
        return schemeType;
      }
    }

    const identifications = this.toArray(
      party.PartyIdentification as XmlObject | XmlObject[] | undefined,
    );

    for (const identification of identifications) {
      const schemeType = this.resolveDocumentTypeFromNode(
        this.getValue<XmlObject>(identification, 'ID'),
      );
      if (schemeType) {
        return schemeType;
      }
    }

    return 'NIT';
  }

  private resolveDocumentTypeFromNode(
    node: XmlValue | null | undefined,
  ): string {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return '';
    }

    const schemeId = this.resolveTextValue(node['@_schemeID']);
    const schemeName = this.resolveTextValue(node['@_schemeName']);

    if (schemeId === '13' || schemeName === '13') {
      return 'CC';
    }

    if (schemeId === '31' || schemeName === '31') {
      return 'NIT';
    }

    const normalizedSchemeName = schemeName.toUpperCase();

    if (
      normalizedSchemeName.includes('CEDULA') ||
      normalizedSchemeName.includes('CÉDULA') ||
      normalizedSchemeName === 'CC' ||
      normalizedSchemeName === 'CI'
    ) {
      return 'CC';
    }

    if (normalizedSchemeName.includes('NIT')) {
      return 'NIT';
    }

    return '';
  }

  private getPartyName(party: XmlObject | null): string {
    if (!party) {
      return '';
    }

    const partyNames = this.toArray(
      party.PartyName as XmlObject | XmlObject[] | undefined,
    );

    for (const partyName of partyNames) {
      const name =
        this.getText(partyName, 'Name') || this.resolveTextValue(partyName);
      if (name) {
        return name;
      }
    }

    const legalEntities = this.toArray(
      party.PartyLegalEntity as XmlObject | XmlObject[] | undefined,
    );

    for (const legalEntity of legalEntities) {
      const name = this.getText(legalEntity, 'RegistrationName');
      if (name) {
        return name;
      }
    }

    return '';
  }

  private getInvoiceDueDate(document: XmlObject): string {
    const dueDate = this.normalizeInvoiceDate(this.getText(document, 'DueDate'));

    if (dueDate) {
      return dueDate;
    }

    const paymentMeans = this.toArray(
      document.PaymentMeans as XmlObject | XmlObject[] | undefined,
    );

    for (const paymentMean of paymentMeans) {
      const paymentDueDate = this.normalizeInvoiceDate(
        this.getText(paymentMean, 'PaymentDueDate'),
      );

      if (paymentDueDate) {
        return paymentDueDate;
      }
    }

    return '';
  }

  private normalizeInvoiceDate(value: string): string {
    const trimmed = value.trim();

    if (!trimmed) {
      return '';
    }

    return matchIsoDate(trimmed) ?? trimmed;
  }

  private getPartyAddress(party: XmlObject | null): string {
    return this.extractFromPartyAddresses(party, (address) =>
      this.getAddressLineFromAddressNode(address),
    );
  }

  private getAddressLineFromAddressNode(address: XmlObject): string {
    const addressLines = this.toArray(
      address.AddressLine as XmlObject | XmlObject[] | undefined,
    );

    const lines = addressLines
      .map((addressLine) => this.getText(addressLine, 'Line'))
      .filter(Boolean);

    if (lines.length > 0) {
      return lines.join(' ');
    }

    const directLineParts = this.toArray(
      address.Line as XmlValue | XmlValue[] | undefined,
    )
      .map((line) => this.resolveTextValue(line))
      .filter(Boolean);

    if (directLineParts.length > 0) {
      return directLineParts.join(' ');
    }

    return this.getText(address, 'StreetName');
  }

  private getPartyPhone(party: XmlObject | null): string {
    const phone = this.getPartyContactField(party, 'Telephone');
    if (phone) {
      return phone;
    }

    return this.getPartyContactField(party, 'Telefax');
  }

  private getPartyEmail(party: XmlObject | null): string {
    return this.getPartyContactField(party, 'ElectronicMail');
  }

  private getPartyStateCode(party: XmlObject | null): string {
    return this.extractFromPartyAddresses(party, (address) => {
      const fromSubentityCode = this.normalizeDaneCode(
        this.getText(address, 'CountrySubentityCode'),
      );

      if (fromSubentityCode) {
        return fromSubentityCode;
      }

      const fromSubentity = this.normalizeDaneCode(
        this.getText(address, 'CountrySubentity'),
      );

      if (fromSubentity && fromSubentity.length <= 2) {
        return fromSubentity;
      }

      return '';
    });
  }

  private getPartyCityCode(party: XmlObject | null): string {
    return this.extractFromPartyAddresses(party, (address) =>
      this.normalizeDaneCode(this.getText(address, 'ID')),
    );
  }

  private getPartyCountryCode(party: XmlObject | null): string {
    const countryCode = this.extractFromPartyAddresses(party, (address) =>
      this.getText(address, 'Country.IdentificationCode'),
    );

    return this.normalizeCountryCodeForSiigo(countryCode);
  }

  private extractFromPartyAddresses(
    party: XmlObject | null,
    extract: (address: XmlObject) => string,
  ): string {
    if (!party) {
      return '';
    }

    for (const postalAddress of this.getPartyPostalAddresses(party)) {
      const value = extract(postalAddress);
      if (value) {
        return value;
      }
    }

    const legalEntities = this.toArray(
      party.PartyLegalEntity as XmlObject | XmlObject[] | undefined,
    );

    for (const legalEntity of legalEntities) {
      const registrationAddress = this.getValue<XmlObject>(
        legalEntity,
        'RegistrationAddress',
      );

      if (!registrationAddress) {
        continue;
      }

      const value = extract(registrationAddress);
      if (value) {
        return value;
      }
    }

    const physicalLocations = this.toArray(
      party.PhysicalLocation as XmlObject | XmlObject[] | undefined,
    );

    for (const location of physicalLocations) {
      const address = this.getValue<XmlObject>(location, 'Address');
      if (!address) {
        continue;
      }

      const value = extract(address);
      if (value) {
        return value;
      }
    }

    return '';
  }

  private normalizeDaneCode(value: string): string {
    return value.replace(/[^\d]/g, '');
  }

  private normalizeCountryCodeForSiigo(countryCode: string): string {
    const trimmed = countryCode.trim();

    if (!trimmed) {
      return 'Co';
    }

    if (trimmed.toUpperCase() === 'CO') {
      return 'Co';
    }

    return trimmed;
  }

  private getPartyPostalCode(party: XmlObject | null): string {
    if (!party) {
      return '';
    }

    for (const postalAddress of this.getPartyPostalAddresses(party)) {
      const postalCode = this.getText(postalAddress, 'PostalZone');
      if (postalCode) {
        return postalCode;
      }
    }

    const physicalLocations = this.toArray(
      party.PhysicalLocation as XmlObject | XmlObject[] | undefined,
    );

    for (const location of physicalLocations) {
      const postalCode = this.getText(location, 'Address.PostalZone');
      if (postalCode) {
        return postalCode;
      }
    }

    return '';
  }

  private getPartyPostalAddresses(party: XmlObject): XmlObject[] {
    return this.toArray(party.PostalAddress as XmlObject | XmlObject[] | undefined);
  }

  private getPartyContactField(
    party: XmlObject | null,
    field: 'Telephone' | 'ElectronicMail' | 'Telefax',
  ): string {
    if (!party) {
      return '';
    }

    const contactSources: XmlObject[] = [
      ...this.toArray(party.Contact as XmlObject | XmlObject[] | undefined),
      ...this.toArray(
        party.PartyLegalEntity as XmlObject | XmlObject[] | undefined,
      ).flatMap((legalEntity) =>
        this.toArray(
          legalEntity.Contact as XmlObject | XmlObject[] | undefined,
        ),
      ),
    ];

    for (const contact of contactSources) {
      const value = this.getText(contact, field);
      if (value) {
        return value;
      }
    }

    return '';
  }

  private resolveTextValue(value: XmlValue | undefined): string {
    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return value
          .map((item) => this.resolveTextValue(item))
          .filter(Boolean)
          .join(' ');
      }

      if ('#text' in value) {
        return String(value['#text']).trim();
      }

      return '';
    }

    return String(value).trim();
  }

  private getText(source: XmlObject | null, path: string): string {
    const value = this.getValue<XmlValue>(source, path);

    if (value === undefined || value === null) {
      return '';
    }

    if (typeof value === 'object') {
      if ('#text' in value) {
        return String(value['#text']).trim();
      }

      return '';
    }

    return String(value).trim();
  }

  private getAmount(source: XmlObject | null, path: string): number {
    const value = this.getValue<XmlValue>(source, path);

    if (value === undefined || value === null || value === '') {
      return 0;
    }

    if (typeof value === 'object') {
      const textValue = value['#text'];

      if (textValue !== undefined) {
        return this.toNumber(textValue);
      }

      return 0;
    }

    return this.toNumber(value);
  }

  private getValue<T>(source: XmlObject | null, path: string): T | null {
    if (!source) {
      return null;
    }

    const keys = path.split('.');
    let current: XmlValue | undefined = source;

    for (const key of keys) {
      if (
        current === undefined ||
        current === null ||
        typeof current !== 'object' ||
        Array.isArray(current)
      ) {
        return null;
      }

      current = (current as XmlObject)[key];
    }

    return (current ?? null) as T | null;
  }

  private toArray<T>(value: T | T[] | null | undefined): T[] {
    if (value === null || value === undefined) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  private toNumber(value: XmlValue): number {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
