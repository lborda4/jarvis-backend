import { BadRequestException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { CreateJarvisInvoiceRequestDto, JarvisInvoicePaymentAllocationDto } from '../dto/create-jarvis-invoice.dto';

/** Internal allocation only. NextPyme continues receiving a single payment_form. */
export async function resolveInvoicePayments(
  source: Pick<DataSource, 'query'>,
  companyId: string,
  request: CreateJarvisInvoiceRequestDto,
  total: number,
): Promise<JarvisInvoicePaymentAllocationDto[] | undefined> {
  const entries = request.paymentBreakdown;
  if (entries === undefined) return undefined;
  const fail = (message: string): never => { throw new BadRequestException(message); };
  if (!Array.isArray(entries) || !entries.length || entries.length > 100)
    fail('Indica entre 1 y 100 pagos para la factura.');
  for (const entry of entries) {
    if (!entry || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.methodId ?? '') ||
      typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) || entry.amount <= 0 ||
      Math.abs(entry.amount * 100 - Math.round(entry.amount * 100)) > 0.00001)
      fail('Cada pago debe tener un medio válido y un importe positivo con máximo dos decimales.');
  }
  const sum = entries.reduce((value, entry) => value + Math.round(entry.amount * 100), 0);
  if (sum !== Math.round(total * 100)) fail('Los pagos deben sumar el total neto de la factura.');
  const ids = [...new Set(entries.map(entry => entry.methodId))];
  const methods: Array<{ id: string; name: string; nextpymeMethodId: number; negotiation: 'CASH' | 'CREDIT' }> = await source.query(
    'SELECT id,name,nextpyme_method_id AS "nextpymeMethodId",negotiation FROM jarvis_payment_methods WHERE company_id=$1 AND id=ANY($2::uuid[])',
    [companyId, ids],
  );
  const result = entries.map(entry => {
    const method = methods.find(item => item.id === entry.methodId);
    if (!method) return fail('Una de las formas de pago no pertenece a esta empresa.');
    if (method.negotiation !== 'CASH' && method.negotiation !== 'CREDIT') return fail('La negociación del medio de pago no es válida.');
    return { methodId: method.id, methodName: method.name, nextpymeMethodId: method.nextpymeMethodId,
      negotiation: method.negotiation, amount: entry.amount };
  });
  const hasCredit = result.some(entry => entry.negotiation === 'CREDIT');
  const primary = hasCredit ? result.find(entry => entry.negotiation === 'CREDIT')! : result[0];
  if (request.payment?.payment_form_id !== (hasCredit ? 2 : 1) || request.payment?.id !== primary.nextpymeMethodId)
    fail('La negociación de la factura debe corresponder a los pagos registrados.');
  if (hasCredit) {
    const due = request.payment?.due_date ?? '';
    const date = new Date(due);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== due || due < request.issueDate)
      fail('Indica un vencimiento válido para el saldo a crédito.');
  }
  return result;
}
