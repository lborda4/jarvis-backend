import { invoicePdfTaxDetails, pdfOptionalText as optionalValue } from './invoice-pdf-fields';
import { invoiceAppearanceColors, normalizeInvoiceAppearance } from './invoice-appearance';
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { amountInSpanish } from './amount-in-spanish';
import type { JarvisInvoicePdfData, JarvisInvoicePdfParty } from './jarvis-invoice-pdf-data';
import { jarvisPdfCopy } from './jarvis-pdf-copy';
import { disablePdfHyphenation, keepPdfWordIntact } from './pdf-text-wrap';

disablePdfHyphenation();

const s = StyleSheet.create({
  page: { padding: 28.35, paddingBottom: 42, fontFamily: 'Helvetica', fontSize: 8, color: '#16335b' },
  half: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 0.6, borderColor: '#cbd9e6', paddingBottom: 10 },
  brandWrap: { width: '45%' },
  brand: { fontFamily: 'Helvetica-Bold', fontSize: 21, color: '#00a8a8', lineHeight: 1.15 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 19, textAlign: 'right', marginBottom: 8 },
  number: { backgroundColor: '#f3f8fb', border: '1 solid #d5e1eb', borderRadius: 4, padding: 6, textAlign: 'center', fontSize: 13, marginBottom: 8 },
  field: { marginBottom: 4 }, heading: { color: '#00a8a8', fontFamily: 'Helvetica-Bold', fontSize: 12, marginBottom: 7 },
  name: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 7 }, parties: { flexDirection: 'row', gap: 20, paddingVertical: 10, borderBottom: '0.6 solid #cbd9e6' },
  table: { marginTop: 8 }, tableRow: { flexDirection: 'row' }, cell: { border: '0.4 solid #d7e1e9', padding: 4, fontSize: 6.5, minWidth: 0 },
  tableHead: { backgroundColor: '#f1f7fa', fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  box: { flex: 1, border: '0.6 solid #d7e1e9', borderRadius: 4, padding: 8, minWidth: 0 },
  financial: { flexDirection: 'row', gap: 12, marginTop: 8 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, gap: 8 },
  total: { backgroundColor: '#dffafa', color: '#006675', padding: 5, fontFamily: 'Helvetica-Bold' },
  words: { border: '0.6 solid #d7e1e9', borderRadius: 4, padding: 8, marginTop: 8 },
  dian: { flexDirection: 'column', gap: 3, marginTop: 8, paddingVertical: 5, borderTop: '0.6 solid #cbd9e6', borderBottom: '0.6 solid #cbd9e6' },
  dianRow: { flexDirection: 'row', gap: 12 },
  uniqueCode: { fontFamily: 'Courier', fontSize: 7 },
  qr: { width: 86, height: 86 }, small: { fontSize: 7 }, footer: { textAlign: 'center', fontSize: 7, color: '#7187a1', marginTop: 6 },
  pageNumber: { position: 'absolute', bottom: 20, right: 28, fontSize: 7, color: '#7187a1' },
});
const money = (value: number) => value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function Party({ title, party, headingColor }: { title: string; party: JarvisInvoicePdfParty; headingColor: string }) {
  const contactFields = [['Dirección', party.address], ['Ciudad', party.cityName], ['Tel', party.phone], ['Correo', party.email]] as const
  return <View style={s.half}><Text style={[s.heading, { color: headingColor }]}>{title}</Text>{optionalValue(party.name) && <Text style={s.name} hyphenationCallback={keepPdfWordIntact}>{optionalValue(party.name)}</Text>}
    {optionalValue(party.documentNumber) && <Text style={s.field}>{optionalValue(party.documentType) || 'Documento'}: {optionalValue(party.documentNumber)}{optionalValue(party.checkDigit) ? `-${optionalValue(party.checkDigit)}` : ''}</Text>}
    {contactFields.map(([label, text]) => optionalValue(text) ? <Text key={label} style={s.field}>{label}: {optionalValue(text)}</Text> : null)}</View>
}
const widths = ['4%', '13%', '18%', '5%', '11%', '8%', '6%', '7%', '7%', '7%', '14%'];
export function SalesInvoicePdfDocument({ data, qr }: { data: JarvisInvoicePdfData; qr: string }) {
  const themed = Boolean(data.invoiceAppearance) && (!data.documentKind || data.documentKind === 'ELECTRONIC_INVOICE');
  const appearance = normalizeInvoiceAppearance(themed ? data.invoiceAppearance : undefined);
  const colors = invoiceAppearanceColors(appearance);
  const headingStyle = themed ? [s.heading, { color: colors.heading }] : s.heading;
  const totalStyle = themed ? [s.totalRow, s.total, { backgroundColor: colors.soft, color: colors.heading }] : [s.totalRow, s.total];
  const taxDetails = invoicePdfTaxDetails(data)
  const generationDateTime = [optionalValue(data.issueDate), optionalValue(data.issueTime)].filter(Boolean).join(' ')
  const copy = jarvisPdfCopy(data.documentKind);
  const related = (data.references ?? []).filter((item) => optionalValue(item.number))
  const lineDiscount = data.items.reduce((sum, item) => sum + (item.discount ?? 0), 0);
  const gross = data.subtotal + lineDiscount;
  const base = data.taxExclusiveAmount ?? data.subtotal;
  const totalTaxes = (data.taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0);
  const beforeRetentions = data.taxInclusiveAmount ?? base + totalTaxes;
  const netPayable = Number((beforeRetentions - data.withholdings.reduce((sum, tax) => sum + (tax.amount ?? 0), 0)).toFixed(2));
  const retention = (code: string) => data.withholdings.filter(t => t.dianTaxCode === code).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const dateDifference = Date.parse(data.dueDate ?? '') - Date.parse(data.issueDate ?? '')
  const days = Number.isFinite(dateDifference) ? Math.max(0, Math.round(dateDifference / 86400000)) : null
  const allocations = data.paymentBreakdown ?? [];
  const mixedPayment = allocations.some(payment => payment.negotiation === 'CASH') && allocations.some(payment => payment.negotiation === 'CREDIT');
  const totals: [string, number][] = [['Total bruto', gross], ['Descuentos', gross - base], ['Subtotal', base], ['IVA', data.iva],
    ...(data.taxes ?? []).filter(t => t.type !== 'IVA').map(t => [t.type, t.amount] as [string, number])];
  return <Document title={`${copy.shortTitle} ${data.invoiceNumber}`} author={data.issuer.name || 'Jarvis'}>
    <Page size="A4" style={s.page}>
      <View style={themed ? [s.header, { borderColor: colors.accent }] : s.header} wrap={false}>
        {data.logoDataUrl && appearance.showLogo ? <Image src={data.logoDataUrl} style={{ width: '45%', height: 80, objectFit: 'contain' }} /> : <View style={s.brandWrap}><Text style={themed ? [s.brand, { color: colors.heading }] : s.brand} hyphenationCallback={keepPdfWordIntact}>{data.issuer.tradeName || data.issuer.name || ''}</Text></View>}
        <View style={{ width: '49%' }}><Text style={s.title}>{copy.title}</Text>{optionalValue(data.invoiceNumber) && <Text style={s.number}>No. {optionalValue(data.invoiceNumber)}</Text>}
          {optionalValue(data.issueDate) && <Text style={s.field}>Fecha de elaboración: {optionalValue(data.issueDate)}</Text>}{data.isCreditPayment && optionalValue(data.dueDate) && <Text style={s.field}>Fecha de vencimiento: {optionalValue(data.dueDate)}</Text>}{optionalValue(data.currency) && <Text>Moneda: {data.currency}</Text>}</View>
      </View>
      <View style={s.parties} wrap={false}><Party title="Emisor" party={data.issuer} headingColor={themed ? colors.heading : s.heading.color} /><Party title={copy.party} party={data.buyer} headingColor={themed ? colors.heading : s.heading.color} /></View>
      {related.length > 0 && <View style={{ paddingVertical: 10, borderBottom: '0.6 solid #cbd9e6' }} wrap={false}>
        {related.map((item, index) => <Text key={`${item.number}-${index}`} style={s.field}>{item.type === 'Factura relacionada' ? copy.related : item.type}: {item.number}{item.date ? ` · ${item.date}` : ''}</Text>)}
      </View>}
      {Boolean(data.sellers?.length) && <View style={{ paddingVertical: 8 }} wrap={false}><Text style={s.field}>Vendedores: {data.sellers?.map(seller => seller.name).join(', ')}</Text></View>}
      <View style={s.table}>
        <View style={s.tableRow} wrap={false}>{['#', 'Producto / servicio', 'Descripción', 'Cant.', 'Valor unitario', 'Descuento', 'IVA (%)', 'ReteFuente (%)', 'ReteICA (‰)', 'ReteIVA (%)', 'Valor total'].map((title, i) => <Text key={title} style={[s.cell, s.tableHead, { width: widths[i], ...(themed ? { backgroundColor: colors.accent, color: colors.onAccent } : {}) }]}>{title}</Text>)}</View>
        {data.items.map((item, i) => {
          const rate = (code: string) =>
            item.withholdings?.find((t) => t.dianTaxCode === code)?.percentage ||
            data.withholdings.find((t) => t.dianTaxCode === code)?.percentage ||
            0;
          const lineTax = item.taxes?.reduce((sum, t) => sum + t.amount, 0) ?? (item.ivaAmount ?? 0);
          const withheld = item.withholdings?.reduce((sum, t) => sum + (t.amount ?? 0), 0) ?? 0;
          const cells = [String(i + 1), item.name || item.code || item.description, item.description, String(item.quantity), money(item.unitValue), money(item.discount ?? 0), String(item.ivaPercentage ?? 0), String(rate('06')), String(rate('07')), String(rate('05')), money(item.total + lineTax - withheld)];
          return <View key={i} style={s.tableRow} wrap={false}>{cells.map((text, j) => <Text key={j} style={[s.cell, { width: widths[j], textAlign: j < 3 ? 'left' : 'right' }]}>{text}</Text>)}</View>;
        })}
      </View>
      <View style={s.financial}>
        <View style={s.box}><Text style={headingStyle}>Detalles de pago</Text>{(mixedPayment || data.isCreditPayment != null) && <Text style={s.field}>Forma de negociación: {mixedPayment ? 'Contado y crédito' : data.isCreditPayment ? 'Crédito' : 'Contado'}</Text>}
          {allocations.length ? allocations.map((payment, index) => <Text key={index} style={s.field}>{payment.methodName} ({payment.negotiation === 'CREDIT' ? 'Crédito' : 'Contado'}): {money(payment.amount)}</Text>) : optionalValue(data.paymentMethodName) && <Text style={s.field}>Forma de pago: {optionalValue(data.paymentMethodName)}</Text>}{data.isCreditPayment && days != null && <Text style={s.field}>Plazo: {days} días después de la emisión</Text>}
          {optionalValue(data.observations) && <><Text style={[s.name, { marginTop: 16 }]}>Observaciones</Text><Text style={s.small}>{optionalValue(data.observations)}</Text></>}</View>
        <View style={s.box} wrap={false}>{totals.map(([label, amount]) => <View key={label} style={s.totalRow}><Text>{label}:</Text><Text>{money(amount)}</Text></View>)}
          <View style={totalStyle}><Text>Total antes de retenciones:</Text><Text>{money(beforeRetentions)}</Text></View>
          {([['ReteFuente', '06'], ['ReteICA', '07'], ['ReteIVA', '05']] as const).map(([label, code]) => <View key={code} style={s.totalRow}><Text>{label}:</Text><Text>-{money(retention(code))}</Text></View>)}
          <View style={totalStyle}><Text>Total neto a pagar:</Text><Text>{money(netPayable)}</Text></View>
        </View>
      </View>
      <View style={s.words} wrap={false}><Text style={headingStyle}>Valor en letras</Text><Text style={s.small}>{amountInSpanish(netPayable, data.currency).toUpperCase()}</Text></View>
      {themed && appearance.footerText && <View style={s.words} wrap={false}><Text style={s.small}>{appearance.footerText}</Text></View>}
      <View style={s.dian} wrap={false}>
        <View style={s.dianRow}>
        <Image src={qr} style={s.qr} />
        <View style={s.half}><Text style={s.name}>Documento electrónico validado por la DIAN</Text>{generationDateTime && <><Text style={[s.field, { marginTop: 7 }]}>Fecha y hora de generación:</Text><Text style={s.small}>{generationDateTime}</Text></>}</View>
        {taxDetails.lines.length > 0 && <View style={s.half}><Text style={s.name}>{taxDetails.title}</Text>
          {taxDetails.lines.map(line => <Text key={line} style={s.small}>{line}</Text>)}</View>}
      </View>
        {taxDetails.activity && <Text style={s.small}>{taxDetails.activity}</Text>}
        {optionalValue(data.cufe) && <Text style={s.uniqueCode} hyphenationCallback={keepPdfWordIntact}>{copy.uniqueCode}: {data.cufe}</Text>}
      </View>
      <Text style={s.footer}>Esta es una representación gráfica de la {copy.footer}.{'\n'}Emitido por Jarvis Colombia</Text>
      <Text fixed style={s.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </Page>
  </Document>;
}
