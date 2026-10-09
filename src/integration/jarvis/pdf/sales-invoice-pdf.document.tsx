import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { amountInSpanish } from './amount-in-spanish';
import type { JarvisInvoicePdfData, JarvisInvoicePdfParty } from './jarvis-invoice-pdf-data';
import { jarvisPdfCopy } from './jarvis-pdf-copy';
import { disablePdfHyphenation, keepPdfWordIntact } from './pdf-text-wrap';

disablePdfHyphenation();

const s = StyleSheet.create({
  page: { padding: 28.35, paddingBottom: 42, fontFamily: 'Helvetica', fontSize: 8, color: '#16335b' },
  half: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 0.6, borderColor: '#cbd9e6', paddingBottom: 14 },
  brandWrap: { width: '45%' },
  brand: { fontFamily: 'Helvetica-Bold', fontSize: 21, color: '#00a8a8', lineHeight: 1.15 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 19, textAlign: 'right', marginBottom: 8 },
  number: { backgroundColor: '#f3f8fb', border: '1 solid #d5e1eb', borderRadius: 4, padding: 6, textAlign: 'center', fontSize: 13, marginBottom: 8 },
  field: { marginBottom: 4 }, heading: { color: '#00a8a8', fontFamily: 'Helvetica-Bold', fontSize: 12, marginBottom: 7 },
  name: { fontFamily: 'Helvetica-Bold', fontSize: 10, marginBottom: 7 }, parties: { flexDirection: 'row', gap: 20, paddingVertical: 14, borderBottom: '0.6 solid #cbd9e6' },
  table: { marginTop: 12 }, tableRow: { flexDirection: 'row' }, cell: { border: '0.4 solid #d7e1e9', padding: 4, fontSize: 6.5, minWidth: 0 },
  tableHead: { backgroundColor: '#f1f7fa', fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  box: { flex: 1, border: '0.6 solid #d7e1e9', borderRadius: 4, padding: 10, minWidth: 0 },
  financial: { flexDirection: 'row', gap: 12, marginTop: 12 }, totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: 8 },
  total: { backgroundColor: '#dffafa', color: '#006675', padding: 7, fontFamily: 'Helvetica-Bold' },
  words: { border: '0.6 solid #d7e1e9', borderRadius: 4, padding: 10, marginTop: 12 },
  dian: { flexDirection: 'row', gap: 12, marginTop: 12, paddingVertical: 12, borderTop: '0.6 solid #cbd9e6', borderBottom: '0.6 solid #cbd9e6' },
  qr: { width: 86, height: 86 }, small: { fontSize: 7 }, footer: { textAlign: 'center', fontSize: 7, color: '#7187a1', marginTop: 14 },
  pageNumber: { position: 'absolute', bottom: 20, right: 28, fontSize: 7, color: '#7187a1' },
});
const money = (value: number) => value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const value = (text: string | null | undefined) => text || '—';
function Party({ title, party }: { title: string; party: JarvisInvoicePdfParty }) {
  return <View style={s.half}><Text style={s.heading}>{title}</Text><Text style={s.name} hyphenationCallback={keepPdfWordIntact}>{value(party.name)}</Text>
    <Text style={s.field}>{party.documentType || 'Documento'}: {value(party.documentNumber)}{party.checkDigit ? `-${party.checkDigit}` : ''}</Text>
    <Text style={s.field}>Dirección: {value(party.address)}</Text><Text style={s.field}>Ciudad: {value(party.cityName)}</Text>
    <Text style={s.field}>Tel: {value(party.phone)}</Text><Text style={s.field}>Correo: {value(party.email)}</Text></View>;
}
const widths = ['4%', '13%', '18%', '5%', '11%', '8%', '6%', '7%', '7%', '7%', '14%'];
export function SalesInvoicePdfDocument({ data, qr }: { data: JarvisInvoicePdfData; qr: string }) {
  const copy = jarvisPdfCopy(data.documentKind);
  const related = (data.references ?? []).filter((item) => item.number);
  const lineDiscount = data.items.reduce((sum, item) => sum + (item.discount ?? 0), 0);
  const gross = data.subtotal + lineDiscount;
  const base = data.taxExclusiveAmount ?? data.subtotal;
  const totalTaxes = (data.taxes ?? []).reduce((sum, tax) => sum + tax.amount, 0);
  const beforeRetentions = data.taxInclusiveAmount ?? base + totalTaxes;
  const retention = (code: string) => data.withholdings.filter(t => t.dianTaxCode === code).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const days = data.issueDate && data.dueDate ? Math.max(0, Math.round((Date.parse(data.dueDate) - Date.parse(data.issueDate)) / 86400000)) : null;
  const totals: [string, number][] = [['Total bruto', gross], ['Descuentos', gross - base], ['Subtotal', base], ['IVA', data.iva],
    ...(data.taxes ?? []).filter(t => t.type !== 'IVA').map(t => [t.type, t.amount] as [string, number])];
  return <Document title={`${copy.shortTitle} ${data.invoiceNumber}`} author={data.issuer.name || 'Jarvis'}>
    <Page size="A4" style={s.page}>
      <View style={s.header} wrap={false}>
        {data.logoDataUrl ? <Image src={data.logoDataUrl} style={{ width: '45%', height: 80, objectFit: 'contain' }} /> : <View style={s.brandWrap}><Text style={s.brand} hyphenationCallback={keepPdfWordIntact}>{data.issuer.tradeName || data.issuer.name || ''}</Text></View>}
        <View style={{ width: '49%' }}><Text style={s.title}>{copy.title}</Text><Text style={s.number}>No. {data.invoiceNumber}</Text>
          <Text style={s.field}>Fecha de elaboración: {value(data.issueDate)}</Text>{data.isCreditPayment && <Text style={s.field}>Fecha de vencimiento: {value(data.dueDate)}</Text>}<Text>Moneda: {data.currency}</Text></View>
      </View>
      <View style={s.parties} wrap={false}><Party title="Emisor" party={data.issuer} /><Party title={copy.party} party={data.buyer} /></View>
      {related.length > 0 && <View style={{ paddingVertical: 10, borderBottom: '0.6 solid #cbd9e6' }} wrap={false}>
        {related.map((item, index) => <Text key={`${item.number}-${index}`} style={s.field}>{item.type === 'Factura relacionada' ? copy.related : item.type}: {item.number}{item.date ? ` · ${item.date}` : ''}</Text>)}
      </View>}
      <View style={s.table}>
        <View style={s.tableRow} wrap={false}>{['#', 'Producto / servicio', 'Descripción', 'Cant.', 'Valor unitario', 'Descuento', 'IVA (%)', 'ReteFuente (%)', 'ReteICA (‰)', 'ReteIVA (%)', 'Valor total'].map((title, i) => <Text key={title} style={[s.cell, s.tableHead, { width: widths[i] }]}>{title}</Text>)}</View>
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
        <View style={s.box}><Text style={s.heading}>Detalles de pago</Text><Text style={s.field}>Forma de negociación: {data.isCreditPayment == null ? '—' : data.isCreditPayment ? 'Crédito' : 'Contado'}</Text>
          <Text style={s.field}>Forma de pago: {value(data.paymentMethodName)}</Text>{data.isCreditPayment && <Text style={s.field}>Plazo: {days ?? '—'} días después de la emisión</Text>}
          <Text style={[s.name, { marginTop: 16 }]}>Observaciones</Text><Text style={s.small}>{value(data.observations)}</Text></View>
        <View style={s.box} wrap={false}>{totals.map(([label, amount]) => <View key={label} style={s.totalRow}><Text>{label}:</Text><Text>{money(amount)}</Text></View>)}
          <View style={[s.totalRow, s.total]}><Text>Total antes de retenciones:</Text><Text>{money(beforeRetentions)}</Text></View>
          {([['ReteFuente', '06'], ['ReteICA', '07'], ['ReteIVA', '05']] as const).map(([label, code]) => <View key={code} style={s.totalRow}><Text>{label}:</Text><Text>-{money(retention(code))}</Text></View>)}
          <View style={[s.totalRow, s.total]}><Text>Total neto a pagar:</Text><Text>{money(data.total)}</Text></View>
        </View>
      </View>
      <View style={s.words} wrap={false}><Text style={s.heading}>Valor en letras</Text><Text style={s.small}>{amountInSpanish(data.total, data.currency).toUpperCase()}</Text></View>
      <View style={s.dian} wrap={false}>
        <Image src={qr} style={s.qr} />
        <View style={s.half}><Text style={s.name}>Documento electrónico validado por la DIAN</Text><Text style={s.field}>{copy.uniqueCode}:</Text><Text style={s.small}>{data.cufe.match(/.{1,32}/g)?.join('\n')}</Text><Text style={[s.field, { marginTop: 7 }]}>Fecha y hora de generación:</Text><Text style={s.small}>{data.issueDate} {data.issueTime}</Text></View>
        <View style={s.half}><Text style={s.name}>Información tributaria y resolución de facturación</Text>
          <Text style={s.small}>Régimen: {value(data.issuer.fiscalRegime)}</Text><Text style={s.small}>Responsabilidad tributaria: {value(data.issuer.taxResponsibility)}</Text><Text style={s.small}>Actividad económica: {value(data.issuer.economicActivity)}</Text>
          <Text style={s.small}>Resolución No. {value(data.authorization?.number)}</Text><Text style={s.small}>Prefijo: {value(data.prefix)}</Text><Text style={s.small}>Desde: {value(data.authorization?.from)}  Hasta: {value(data.authorization?.to)}</Text><Text style={s.small}>Vigencia: {value(data.authorization?.startDate)} a {value(data.authorization?.endDate)}</Text></View>
      </View>
      <Text style={s.footer}>Esta es una representación gráfica de la {copy.footer}.{'\n'}Documento electrónico generado por Jarvis</Text>
      <Text fixed style={s.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </Page>
  </Document>;
}
