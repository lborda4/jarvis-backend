import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import type { PayrollInput, PayrollWorker } from './payroll-domain';
import { totals } from './payroll-domain';
import { disablePdfHyphenation } from '../integration/jarvis/pdf/pdf-text-wrap';
type PayrollDetail = { state: PayrollInput & { payrollName?: string }; employee_snapshot: PayrollWorker; parameter_snapshot: { concepts: { code: string; kind: string; name: string }[] }; number?: string | null; prefix?: string | null };
const employeeName = (worker: PayrollWorker) => [worker.firstName, worker.secondName, worker.surname, worker.secondSurname].filter(Boolean).join(' ');
const currency = (value: string) => Number(value).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2 });
const payrollQuantity = (value: string) => value === '' ? '' : Number(value).toLocaleString('es-CO', { maximumFractionDigits: 2 });

disablePdfHyphenation()

// PDF styles use literal print values because the renderer does not support CSS variables.
const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingHorizontal: 80, paddingBottom: 48, fontFamily: 'Helvetica', fontSize: 8, color: '#1f2937' },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingBottom: 10, borderBottom: '2 solid #0d9488' },
  company: { width: '42%', paddingLeft: 8, borderLeft: '3 solid #0d9488' },
  companyName: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#16335b', marginBottom: 3 },
  muted: { color: '#5b6875', fontSize: 7 },
  document: { flex: 1, textAlign: 'right', justifyContent: 'center' },
  title: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#16335b', marginBottom: 3 },
  subtitle: { fontSize: 7, color: '#5b6875' },
  period: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottom: '0.5 solid #d7dee7' },
  field: { flex: 1, minWidth: 0 }, wideField: { flex: 2 },
  fieldLabel: { fontSize: 6.5, color: '#5b6875', marginBottom: 3, letterSpacing: 0.3 },
  fieldValue: { fontFamily: 'Helvetica-Bold', lineHeight: 1.25 },
  employee: { flexDirection: 'row', gap: 10, paddingVertical: 9 },
  employeeName: { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#16335b', marginBottom: 3 },
  employeeDetail: { fontSize: 7, lineHeight: 1.25, color: '#5b6875' },
  right: { textAlign: 'right' },
  row: { flexDirection: 'row', borderBottom: '0.5 solid #e1e7ee', minHeight: 20 },
  alternate: { backgroundColor: '#f7f9fb' },
  labels: { flexDirection: 'row', backgroundColor: '#16335b', color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 7 },
  cell: { paddingHorizontal: 6, paddingVertical: 5, minWidth: 0, lineHeight: 1.25 },
  concept: { width: '44%' }, quantity: { width: '12%', textAlign: 'right' }, value: { width: '22%', textAlign: 'right' },
  totals: { flexDirection: 'row', backgroundColor: '#eef2f6', fontFamily: 'Helvetica-Bold', color: '#16335b', borderTop: '0.7 solid #c3ccd8' },
  totalLabel: { width: '56%' },
  net: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 9, marginTop: 9, backgroundColor: '#e6f7f5', borderLeft: '3 solid #0d9488' },
  netLabel: { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#16335b' },
  netCaption: { fontSize: 7, color: '#5b6875', marginTop: 3 },
  netValue: { fontFamily: 'Helvetica-Bold', fontSize: 14, color: '#16335b', textAlign: 'right' },
  footer: { position: 'absolute', bottom: 25, left: 80, right: 80, paddingTop: 6, borderTop: '0.5 solid #d7dee7', flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#5b6875' },
})

export interface PayrollPayslipProps {
  detail: PayrollDetail
  company: { name: string; nit: string }
  position?: string
}

export function PayrollPayslipPdf({ detail, company, position }: PayrollPayslipProps) {
  const { state, employee_snapshot: employee, parameter_snapshot: parameters } = detail
  const accrued = state.lines.filter(line => line.kind === 'accrued')
  const deductions = state.lines.filter(line => line.kind === 'deduction')
  const total = totals(state.lines)
  const date = (value: string) => value.split('-').reverse().join('/')
  const label = (line: typeof state.lines[number]) => {
    const name = parameters.concepts.find(concept => concept.code === line.concept && concept.kind === line.kind)?.name ?? line.concept
    return line.description?.trim() ? `${name}: ${line.description.trim()}` : name
  }
  const lines = [...accrued, ...deductions]
  const reference = detail.number && (detail.number.startsWith(detail.prefix ?? '') ? detail.number : (detail.prefix ?? '') + detail.number)
  const paymentDates = (state.paymentDates ?? []).map(date).join(' · ')
  return <Document title={`Desprendible de nómina - ${employeeName(employee)} - ${state.startDate}`} author={company.name}>
    <Page size="A4" style={styles.page}>
      <View fixed>
        <View style={styles.header}>
          <View style={styles.company}><Text style={styles.companyName}>{company.name}</Text>{company.nit && <Text style={styles.muted}>NIT {company.nit}</Text>}</View>
          <View style={styles.document}>
            <Text style={styles.title}>Desprendible de nómina</Text>
            <Text style={styles.subtitle}>{state.payrollName || 'Comprobante de pago'}</Text>
          </View>
        </View>
        <View style={styles.period}>
          <View style={[styles.field, styles.wideField]}><Text style={styles.fieldLabel}>PERÍODO LIQUIDADO</Text><Text style={styles.fieldValue}>{date(state.startDate)} — {date(state.endDate)}</Text></View>
          {paymentDates && <View style={styles.field}><Text style={styles.fieldLabel}>FECHA DE PAGO</Text><Text style={styles.fieldValue}>{paymentDates}</Text></View>}
          {reference && <View style={[styles.field, styles.right]}><Text style={styles.fieldLabel}>COMPROBANTE</Text><Text style={styles.fieldValue}>{reference}</Text></View>}
        </View>
        <View style={styles.employee}>
          <View style={[styles.field, styles.wideField]}><Text style={styles.fieldLabel}>EMPLEADO</Text><Text style={styles.employeeName}>{employeeName(employee)}</Text>{position && <Text style={styles.employeeDetail}>Cargo: {position}</Text>}</View>
          <View style={styles.field}><Text style={styles.fieldLabel}>IDENTIFICACIÓN</Text><Text style={styles.fieldValue}>{employee.identification}</Text>{employee.workerCode && <Text style={styles.employeeDetail}>Código: {employee.workerCode}</Text>}</View>
          <View style={[styles.field, styles.right]}><Text style={styles.fieldLabel}>SALARIO BÁSICO</Text><Text style={styles.fieldValue}>{currency(employee.salary)}</Text></View>
        </View>
        <View style={styles.labels}>
          <Text style={[styles.cell, styles.concept]}>CONCEPTO</Text><Text style={[styles.cell, styles.quantity]}>CANT.</Text><Text style={[styles.cell, styles.value]}>INGRESOS</Text><Text style={[styles.cell, styles.value]}>DEDUCCIONES</Text>
        </View>
      </View>
      {lines.map((line, index) => <View key={line.id} style={[styles.row, ...(index % 2 ? [styles.alternate] : [])]} wrap={false}>
        <Text style={[styles.cell, styles.concept]}>{label(line)}</Text>
        <Text style={[styles.cell, styles.quantity]}>{payrollQuantity(line.quantity ?? '')}</Text>
        <Text style={[styles.cell, styles.value]}>{line.kind === 'accrued' ? currency(line.amount) : ''}</Text>
        <Text style={[styles.cell, styles.value]}>{line.kind === 'deduction' ? currency(line.amount) : ''}</Text>
      </View>)}
      {!lines.length && <View style={styles.row} wrap={false}><Text style={styles.cell}>Sin conceptos en este período.</Text></View>}
      <View wrap={false}>
        <View style={styles.totals}>
          <Text style={[styles.cell, styles.totalLabel]}>TOTALES DEL PERÍODO</Text><Text style={[styles.cell, styles.value]}>{currency(total.accrued)}</Text><Text style={[styles.cell, styles.value]}>{currency(total.deductions)}</Text>
        </View>
        <View style={styles.net}>
          <View><Text style={styles.netLabel}>NETO A PAGAR</Text><Text style={styles.netCaption}>Ingresos menos deducciones</Text></View><Text style={styles.netValue}>{currency(total.net)}</Text>
        </View>
      </View>
      <View style={styles.footer} fixed>
        <Text>Comprobante elaborado con Jarvis Colombia.</Text>
        <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
      </View>
    </Page>
  </Document>
}

export function generatePayrollPayslip(props: PayrollPayslipProps) {
  return renderToBuffer(<PayrollPayslipPdf {...props} />)
}
