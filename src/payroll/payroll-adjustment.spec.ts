jest.mock('../integration/jarvis/helpers/unlimited-note-credit', () => ({ creditUnlimitedNote: jest.fn().mockResolvedValue('APPLIED') }));
import { creditUnlimitedNote } from '../integration/jarvis/helpers/unlimited-note-credit';
import { Logger } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { buildPayrollDeletionPayload, payrollAdjustmentProjection, payrollAdjustmentState, payrollPredecessor } from './payroll-adjustment';
import { buildPayrollPayload } from './payroll-domain';
import { payrollPayloadRequiredErrors } from './payroll-payload-required';
import { buildPayrollReplacementPayload, payrollReplacementTotals } from './payroll-replacement';

const company = 'company-a';
const stamp = '2026-11-15T12:00:00.000Z';
const worker = { workerCode: 'EMP001', identification: '12345678', firstName: 'Ana', surname: 'Pérez',
  salary: '1000', admittanceDate: '2026-01-01', typeWorkerId: 1, subTypeWorkerId: 1, documentTypeId: 3,
  paymentMethodId: 10, active: true, address: 'Calle 1', municipalityId: 439, typeContractId: 1 };
const original = { id: 'original', company_id: company, employee_id: 'employee-a', status: 'ACCEPTED', number: 6,
  prefix: 'NI', cune: 'b'.repeat(96), updated_at: stamp, employee_snapshot: worker, parameter_snapshot: { concepts: [
    { code: 'salary', kind: 'accrued', active: true }, { code: 'eps', kind: 'deduction', active: true }, { code: 'pension', kind: 'deduction', active: true } ] },
  state: { employeeId: 'employee-a', period: '2026-10', startDate: '2026-10-01', endDate: '2026-10-31', issueDate: '2026-11-01',
    periodicity: 'MONTHLY', payrollPeriodId: 5, payrollGroupId: 'old-group', monthlyDocumentId: 'old-month', monthlyConsolidation: { generated: true },
    workedDays: '30', paymentDates: ['2026-10-31'], lines: [
      { id: 's', concept: 'salary', kind: 'accrued', quantity: '30', amount: '1000' },
      { id: 'e', concept: 'eps', kind: 'deduction', quantity: '1', amount: '0', typeLawDeductionsId: 4 },
      { id: 'p', concept: 'pension', kind: 'deduction', quantity: '1', amount: '0', typeLawDeductionsId: 6 },
    ] } };
const changes = () => ({ ...structuredClone(original.state), issueDate: '2026-11-16', notes: 'Corrección de nómina' });

function harness(noteType: 1 | 2 = 1) {
  const documents = new Map<string, any>([[original.id, structuredClone(original)]]);
  let notesCounter = 1;
  const query = jest.fn(async (sql: string, params: any[] = []): Promise<any[]> => {
    if (sql.startsWith('SELECT') && params[0] !== company) return [];
    if (sql.startsWith('SELECT * FROM jarvis_payroll_documents')) return documents.has(params[1]) ? [documents.get(params[1])] : [];
    if (sql.startsWith('SELECT id,status FROM jarvis_payroll_documents')) return [...documents.values()].filter(row => row.original_id === params[1]);
    if (sql.startsWith('SELECT data,active')) return [{ data: worker, active: true }];
    if (sql.startsWith('SELECT data FROM jarvis_payroll_parameters')) return [{ data: original.parameter_snapshot }];
    if (sql.startsWith('SELECT * FROM jarvis_payroll_settings')) return [{ next_number: 50, next_note_number: notesCounter }];
    if (sql.startsWith('SELECT nit FROM companies')) return [{ nit: '900123456' }];
    if (sql.startsWith('INSERT INTO jarvis_payroll_documents')) {
      const [id, , employee, predecessor, state, snapshot, parameters, accrued, deductions, net] = params;
      documents.set(id, { ...documents.get(id), id, employee_id: employee, original_id: predecessor, state: JSON.parse(state),
        employee_snapshot: JSON.parse(snapshot), parameter_snapshot: JSON.parse(parameters), accrued, deductions, net, status: 'DRAFT', updated_at: stamp });
      return [{ id }];
    }
    if (sql.includes("SET status='PROCESSING'")) Object.assign(documents.get(params[1]), { status: 'PROCESSING', number: params[2], prefix: params[3] });
    if (sql.includes('SET status=$3,cune=$4')) Object.assign(documents.get(params[1]), { status: params[2], cune: params[3] });
    if (sql.includes('SET next_note_number=next_note_number+1')) notesCounter++;
    return [];
  });
  const api = { getPayrollIssuerConfiguration: jest.fn().mockResolvedValue({ identificationNumber: '900123456', payrollEnvironment: 1, payrollSoftwareConfigured: true, payrollPinConfigured: true }),
    payrollPlanInfo: jest.fn().mockResolvedValue({ docs_left_absolut: 100 }),
    payrollRequest: jest.fn().mockResolvedValue({ success: true, ResponseDian: { IsValid: 'true' }, cune: 'a'.repeat(96) }) };
  const catalogs = { requireCompanyToken: jest.fn().mockResolvedValue('private-company-token'),
    getPayrollWorkerCatalogs: jest.fn().mockResolvedValue({ paymentMethods: [{ id: 10, name: 'Efectivo', code: '10' }] }),
    getPayrollPeriodId: jest.fn().mockResolvedValue(5) };
  const plans = { withJarvisQuotaLock: jest.fn(async (_company, fn) => fn()), assertCanCreateDocuments: jest.fn() };
  const db = { query, transaction: jest.fn(async fn => fn({ query })) };
  const service = new PayrollService(db as any, catalogs as any, api as any, plans as any);
  const prepare = (state = changes(), overrides: any = {}) => service.prepareAdjustment(company, 'actor', 'original', 'note', { noteType, state, originalUpdatedAt: stamp, ...overrides });
  return { service, prepare, documents, query, api, catalogs, plans };
}

beforeEach(() => { jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {}); jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

it('copia la nómina histórica sin mutar el original ni sus vínculos de consolidación', () => {
  const source = structuredClone(original);
  const state = payrollAdjustmentState(source, 1, { ...changes(), originalId: 'otro', employeeId: 'otro', startDate: '2026-09-01', lines: [{ ...source.state.lines[0], amount: '1200' }] });
  expect(source).toEqual(original);
  expect(state).toMatchObject({ originalId: 'original', employeeId: 'employee-a', startDate: '2026-10-01', payrollPeriodId: 5, noteType: 1, issueDate: '2026-11-16' });
  expect(state.monthlyConsolidation).toBeUndefined(); expect(state.monthlyDocumentId).toBeUndefined(); expect(state.payrollGroupId).toBeUndefined();
  expect(state.lines[0].amount).toBe('1200'); expect(state.lines[0].id).not.toBe('s');
});

it('genera eliminación con el cuerpo reducido del ejemplo y referencia del documento real', () => {
  const state = payrollAdjustmentState(original, 2, { ...changes(), lines: [] });
  const body = buildPayrollDeletionPayload(state, worker, 7, 'NA', payrollPredecessor(original));
  expect(body).toMatchObject({ type_document_id: 10, type_note: 2, prefix: 'NA', consecutive: 7, payroll_period_id: 5,
    predecessor: { predecessor_number: 'NI6', predecessor_cune: original.cune, predecessor_issue_date: '2026-11-01' }, period: { issue_date: '2026-11-16', settlement_start_date: '2026-10-01' } });
  expect(body).not.toHaveProperty('worker'); expect(body).not.toHaveProperty('payment'); expect(body).not.toHaveProperty('accrued'); expect(body).not.toHaveProperty('deductions');
  expect(payrollPayloadRequiredErrors(body)).toEqual([]);
  expect(state.lines).toHaveLength(original.state.lines.length);
});

it('reemplazo contiene nómina completa corregida y exige predecesor en el JSON final', () => {
  const state = payrollAdjustmentState(original, 1, changes());
  const body = buildPayrollPayload(state, worker, 8, 'NA', payrollPredecessor(original), { validation: 'provider' });
  expect(body).toMatchObject({ type_document_id: 10, type_note: 1, worker: { identification_number: worker.identification }, accrued: { salary: '1000.00' }, deductions: { eps_deduction: '0.00' } });
  expect(payrollPayloadRequiredErrors(body)).toEqual([]);
  delete (body as any).predecessor.predecessor_cune;
  expect(payrollPayloadRequiredErrors(body)).toContainEqual(expect.stringContaining('predecessor_cune'));
});

it.each([1, 2] as const)('prepara y envía tipo %s con token de empresa y contador NA separado', async type => {
  const { service, prepare, documents, api, query, plans } = harness(type);
  plans.assertCanCreateDocuments.mockImplementation(async ({quantity}) => { if(quantity > 0)throw new Error('Cupo agotado'); });
  const prepared = await prepare();
  expect(prepared.status).toBe('DRAFT'); expect(api.payrollRequest).not.toHaveBeenCalled();
  const result = await service.sendDocument(company, 'actor', 'note');
  expect(result.status).toBe('ACCEPTED');
  expect(plans.assertCanCreateDocuments).toHaveBeenCalledWith(expect.objectContaining({quantity:0}));
  expect(creditUnlimitedNote).toHaveBeenCalledWith(expect.anything(), api, company, 'PAYROLL_ADJUSTMENT:note');
  expect(api.payrollRequest).toHaveBeenCalledWith('payroll-adjust-note', expect.objectContaining({ type_note: type, prefix: 'NA', consecutive: 1 }), 'private-company-token');
  expect(documents.get('original')).toEqual(original);
  expect(query.mock.calls.some(([sql]) => sql.includes('SET next_number=next_number+1'))).toBe(false);
  await expect(service.sendDocument(company, 'actor', 'note')).rejects.toThrow('ya se envió');
  expect(api.payrollRequest).toHaveBeenCalledTimes(1);
});

it('eliminar no exige datos bancarios ni deducciones actuales', async () => {
  const { prepare, service, documents, api, catalogs } = harness(2);
  const row = documents.get('original'); row.employee_snapshot = { ...worker, paymentMethodId: 30, bankName: '', address: '', municipalityId: 0 }; row.state.lines = [];
  await prepare(); await service.sendDocument(company, 'actor', 'note');
  expect(api.payrollRequest).toHaveBeenCalledTimes(1); expect(catalogs.getPayrollWorkerCatalogs).not.toHaveBeenCalled();
});

it('reutiliza el mismo borrador al repetir una preparación sin volver a escribir', async () => {
  const { prepare, query } = harness();
  await prepare(); await prepare();
  expect(query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO jarvis_payroll_documents'))).toHaveLength(1);
});

it('no puede preparar un documento de otra empresa, no aceptado o ya anulado', async () => {
  const { service, documents, prepare } = harness();
  await expect(service.prepareAdjustment('other-company', 'actor', 'original', 'note', { noteType: 1, state: changes() })).rejects.toThrow('encontrada');
  documents.get('original').status = 'REJECTED'; await expect(prepare()).rejects.toThrow('aceptado');
  documents.get('original').status = 'ACCEPTED'; documents.get('original').state.noteType = 2;
  await expect(prepare()).rejects.toThrow('anulado');
  expect(documents.has('note')).toBe(false);
});

it('bloquea versiones antiguas y no sobrescribe un ajuste de otra pestaña', async () => {
  const { prepare, documents } = harness();
  await expect(prepare(changes(), { originalUpdatedAt: '2026-10-01' })).rejects.toThrow('cambió');
  await prepare();
  await expect(prepare({ ...changes(), notes: 'Cambio nuevo' })).rejects.toThrow('cambió');
  expect(documents.get('note').state.notes).toBe('Corrección de nómina');
});

it('un segundo ajuste no puede competir con uno aceptado o pendiente', async () => {
  const { service, prepare, documents } = harness(); await prepare();
  for (const status of ['DRAFT', 'PROCESSING', 'UNCERTAIN', 'REJECTED', 'ACCEPTED']) {
    documents.get('note').status = status;
    await expect(service.prepareAdjustment(company, 'actor', 'original', 'other-note', { noteType: 2, state: changes(), originalUpdatedAt: stamp })).rejects.toThrow('ya tiene un ajuste');
  }
  expect(documents.has('other-note')).toBe(false);
});

it('sigue la cadena de reemplazos y bloquea nuevos ajustes al aceptar una eliminación', () => {
  const notes = [{ id: 'replacement', original_id: 'original', status: 'ACCEPTED', state: { noteType: 1 } },
    { id: 'deletion', original_id: 'replacement', status: 'UNCERTAIN', state: { noteType: 2 } }];
  expect(payrollAdjustmentProjection('original', notes)).toMatchObject({ adjustmentTargetId: 'replacement', adjustment: { id: 'deletion', status: 'UNCERTAIN' } });
  notes[1].status = 'ACCEPTED';
  expect(payrollAdjustmentProjection('original', notes)).toMatchObject({ adjustmentTargetId: null, adjustment: { id: 'deletion', noteType: 2 } });
});

it('serializa las nuevas vacaciones, licencias, primas, cesantías y comisiones como en el ejemplo', () => {
  const state = payrollAdjustmentState(original, 1, { ...changes(), lines: [
    ...original.state.lines,
    { id: 'v', concept: 'vacation', kind: 'accrued', amount: '200', quantity: '5', startDate: '2026-10-01', endDate: '2026-10-05' },
    { id: 'vp', concept: 'vacation_paid', kind: 'accrued', amount: '100', quantity: '2' },
    { id: 'pr', concept: 'service_bonus', kind: 'accrued', amount: '100', paymentNS: '20', quantity: '30' },
    { id: 'ce', concept: 'severance', kind: 'accrued', amount: '100', interestPayment: '12', percentage: '12', quantity: '30' },
    { id: 'l', concept: 'paid_leave', kind: 'accrued', amount: '50', quantity: '1', startDate: '2026-10-06', endDate: '2026-10-06' },
    { id: 'c', concept: 'commissions', kind: 'accrued', amount: '25', quantity: '1' },
  ] });
  const body = buildPayrollReplacementPayload(state, worker, 8, 'NA', payrollPredecessor(original));
  expect(body.accrued).toMatchObject({
    common_vacation: [{ start_date: '2026-10-01', end_date: '2026-10-05', quantity: 5, payment: '200.00' }],
    paid_vacation: [{ quantity: 2, payment: '100.00' }],
    service_bonus: [{ quantity: 30, payment: '100.00', paymentNS: '20.00' }],
    severance: [{ payment: '100.00', percentage: '12', interest_payment: '12.00' }],
    paid_leave: [{ start_date: '2026-10-06', end_date: '2026-10-06', quantity: 1, payment: '50.00' }],
    commissions: [{ commission: '25.00' }], accrued_total: '1607.00',
  });
  expect(body.accrued).not.toHaveProperty('vacation');
  expect(body.accrued).not.toHaveProperty('vacation_paid');
  expect(payrollReplacementTotals(state.lines)).toEqual({ accrued: '1607.00', deductions: '0.00', net: '1607.00' });
});
