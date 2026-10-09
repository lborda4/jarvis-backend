import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import QRCode from 'qrcode';
import type { JarvisInvoicePdfData } from './jarvis-invoice-pdf-data';
import { SalesInvoicePdfDocument } from './sales-invoice-pdf.document';

/** Misma representación gráfica que el visor de JARVIS (`salesInvoicePdf`). */
export async function renderJarvisInvoicePdfBase64(
  data: JarvisInvoicePdfData,
): Promise<string> {
  const qr = await QRCode.toDataURL(data.dianQrText, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: 'M',
  });
  const document = createElement(SalesInvoicePdfDocument, { data, qr });
  const buffer = await renderToBuffer(document);
  return buffer.toString('base64');
}
