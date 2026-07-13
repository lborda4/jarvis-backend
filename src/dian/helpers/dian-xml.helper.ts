import AdmZip from 'adm-zip';

const INVOICE_XML_PATTERN = /<Invoice\b/i;
const CREDIT_NOTE_XML_PATTERN = /<CreditNote\b/i;
const DEBIT_NOTE_XML_PATTERN = /<DebitNote\b/i;

export function isZipBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function normalizeXmlString(content: string): string {
  return content.replace(/^\uFEFF/, '').trim();
}

export function looksLikeXmlContent(content: string): boolean {
  const normalized = normalizeXmlString(content);
  return normalized.startsWith('<') || normalized.startsWith('<?xml');
}

export function extractInvoiceXmlFromZip(zipBuffer: Buffer): string {
  const zip = new AdmZip(zipBuffer);
  const xmlEntries = zip
    .getEntries()
    .filter(
      (entry) =>
        !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.xml'),
    );

  if (xmlEntries.length === 0) {
    throw new Error('No se encontró XML dentro del archivo ZIP.');
  }

  const invoiceEntry = xmlEntries.find((entry) => {
    const name = entry.entryName.toLowerCase();
    return (
      name.includes('invoice') ||
      name.includes('factura') ||
      name.includes('fv') ||
      name.includes('fe')
    );
  });

  if (invoiceEntry) {
    return normalizeXmlEntry(invoiceEntry);
  }

  const entryWithInvoiceDocument = xmlEntries.find((entry) => {
    const content = entry.getData().toString('utf8');
    return containsInvoiceDocument(content);
  });

  if (entryWithInvoiceDocument) {
    return normalizeXmlEntry(entryWithInvoiceDocument);
  }

  return normalizeXmlEntry(xmlEntries[0]);
}

function containsInvoiceDocument(content: string): boolean {
  return (
    INVOICE_XML_PATTERN.test(content) ||
    CREDIT_NOTE_XML_PATTERN.test(content) ||
    DEBIT_NOTE_XML_PATTERN.test(content)
  );
}

function normalizeXmlEntry(entry: AdmZip.IZipEntry): string {
  const xmlContent = normalizeXmlString(entry.getData().toString('utf8'));

  if (!xmlContent) {
    throw new Error(`El archivo XML "${entry.entryName}" está vacío.`);
  }

  return xmlContent;
}
