import { BadGatewayException } from '@nestjs/common';

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}
function scalar(value: unknown): unknown {
  return record(value)?._value ?? value;
}

/** Accept the DIAN GetXmlByDocumentKey envelope as well as legacy XML responses. */
export function extractNextPymeInvoiceXml(value: unknown, depth = 0): string {
  if (depth > 5)
    throw new BadGatewayException('NextPyme no devolvio un XML de factura.');
  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.startsWith('<')) return raw;
    if (/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
      const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
      if (decoded.startsWith('<')) return decoded;
    }
  }
  const payload = record(value);
  if (payload) {
    // This is the response returned by POST /xml/document/{cufe}.
    // Traverse its exact path, independently of the legacy envelope depth limit.
    let result: unknown = payload;
    for (const key of [
      'ResponseDian',
      'Envelope',
      'Body',
      'GetXmlByDocumentKeyResponse',
      'GetXmlByDocumentKeyResult',
    ]) {
      result = record(result)?.[key];
    }
    const dianResult = record(result);
    if (dianResult) {
      const code = scalar(dianResult.Code);
      if (code !== undefined && String(code).trim() !== '100') {
        throw new BadGatewayException(
          `La DIAN no entrego el XML de la factura (codigo ${String(code)}).`,
        );
      }
      return extractNextPymeInvoiceXml(scalar(dianResult.XmlBytesBase64), 0);
    }
    for (const key of [
      'xml',
      'invoiceXml',
      'invoice_xml',
      'XmlBase64',
      'xmlBase64',
      'xml_base64',
      'XmlBytes',
      'XmlBytesBase64',
      'xml_document',
      'document',
      'data',
    ]) {
      if (payload[key] !== undefined) {
        try {
          return extractNextPymeInvoiceXml(scalar(payload[key]), depth + 1);
        } catch {
          /* Try another supported envelope field. */
        }
      }
    }
  }
  throw new BadGatewayException('NextPyme no devolvio un XML de factura.');
}
