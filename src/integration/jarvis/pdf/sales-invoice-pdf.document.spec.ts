jest.mock('@react-pdf/renderer', () => ({
  Document: 'Document', Image: 'Image', Page: 'Page', Text: 'Text', View: 'View',
  StyleSheet: { create: (styles: unknown) => styles },
  Font: { registerHyphenationCallback: jest.fn() },
}));

import { isValidElement, type ReactNode } from 'react';
import { DOWNLOAD_XML } from '../../../electronic-document/mappers/invoice-xml-download.fixture';
import { mapInvoiceXmlToPurchaseInvoiceDownload } from '../../../electronic-document/mappers/invoice-xml-to-purchase-invoice-download.mapper';
import { SalesInvoicePdfDocument } from './sales-invoice-pdf.document';

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return '';
}

it('presenta la orden y fecha después de la generación solo para facturas', () => {
  const data = { ...mapInvoiceXmlToPurchaseInvoiceDownload(DOWNLOAD_XML, 'id', 'cufe-123'),
    documentKind: 'ELECTRONIC_INVOICE', orderNumber: 'OC-001', orderDate: '2024-01-10' };
  const text = textContent(SalesInvoicePdfDocument({ data, qr: '' }));
  expect(text).toContain('Orden de compra: OC-001');
  expect(text).toContain('Fecha de orden de compra: 2024-01-10');
  expect(text.indexOf('Orden de compra:')).toBeGreaterThan(text.indexOf('Fecha y hora de generación:'));
  expect(textContent(SalesInvoicePdfDocument({ data: { ...data, documentKind: 'CREDIT_NOTE' }, qr: '' }))).not.toContain('Orden de compra:');
  expect(textContent(SalesInvoicePdfDocument({ data: { ...data, orderNumber: null }, qr: '' }))).not.toContain('Orden de compra:');
});

it('prints a demonstration label and no DIAN validation claim for demo documents',()=>{
  const data={...mapInvoiceXmlToPurchaseInvoiceDownload(DOWNLOAD_XML,'id','cufe-123'),isDemo:true};
  const document=SalesInvoicePdfDocument({data,qr:''});
  const text=textContent(document);
  expect(text).toContain('DEMOSTRACIÓN · SIN VALIDEZ TRIBUTARIA');
  expect(text).not.toContain('Documento electrónico validado por la DIAN');
  expect(text).toContain('Código de simulación:');
});
