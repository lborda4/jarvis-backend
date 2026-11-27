import { PayrollService } from './payroll.service';
import { Logger } from '@nestjs/common';
import { monthlyRevisions } from './payroll-monthly';
const company = 'company', employee = 'employee';
function harness(fullMonth = false) {
  const worker = { workerCode: 'EMP001', identification: '123', firstName: 'Ana', surname: 'Pérez', admittanceDate: '2026-01-01', salary: '2000', paymentMethodId: 1, typeWorkerId: 1, subTypeWorkerId: 1, documentTypeId: 3, address: 'Calle 1', municipalityId: 439, typeContractId: 1 };
  const sources = (fullMonth ? [1] : [1, 2]).map(half => ({ id: `source-${half}`, employee_id: employee, status: 'DRAFT', updated_at: '2026-11-01T00:00:00.000Z', employee_snapshot: worker, parameter_snapshot: { concepts: [{ code: 'salary', kind: 'accrued', category: 'Salario' }] },
    state: { period: '2026-10', startDate: `2026-10-${half === 1 ? '01' : '16'}`, endDate: `2026-10-${fullMonth || half === 2 ? '31' : '15'}`, periodicity: fullMonth ? 'MONTHLY' : half === 1 ? 'FIRST_HALF' : 'SECOND_HALF', workedDays: fullMonth ? '30' : '15', issueDate: '2026-11-01', paymentDates: ['2026-10-31'], lines: [{ id: 'salary', concept: 'salary', kind: 'accrued', quantity: '15', amount: '1000' }] } }));
  const documents = new Map<string, any>(sources.map(row => [row.id, structuredClone(row)]));
  const query = jest.fn(async (sql: string, params: any[] = []) => {
    if (sql.startsWith('SELECT') && sql.includes('company_id=$1') && params[0] !== company) return [];
    if (sql.startsWith('SELECT *') && sql.includes('employee_id=$2')) return [...documents.values()].filter(row => row.employee_id === params[1] && row.state.period === params[2] && (!sql.includes("IS DISTINCT FROM 'true'") || !row.state.monthlyConsolidation?.generated));
    if (sql.startsWith('SELECT * FROM jarvis_payroll_documents')) return documents.has(params[1]) ? [documents.get(params[1])] : [];
    if (sql.startsWith('SELECT data,active')) return [{ data: worker, active: true }];
    if (sql.startsWith('INSERT INTO jarvis_payroll_documents')) {
      const [id, , emp, state, snapshot, parameters, accrued, deductions, net] = params;
      documents.set(id, { ...documents.get(id), id, employee_id: emp, status: 'DRAFT', state: JSON.parse(state), employee_snapshot: JSON.parse(snapshot), parameter_snapshot: JSON.parse(parameters), accrued, deductions, net, updated_at: '2026-11-12T00:00:00.000Z' });
      return [{ id, updated_at: '2026-11-12T00:00:00.000Z' }];
    }
    if (sql.includes("'{monthlyDocumentId}'")) for (const id of params[1]) documents.get(id).state.monthlyDocumentId = params[2];
    if (sql.includes("'{monthlyConsolidation}'")) documents.get(params[1]).state.monthlyConsolidation = JSON.parse(params[2]);
    return [];
  });
  const catalogs = { getPayrollPeriodId: jest.fn(async () => fullMonth ? 5 : 4) };
  const db = { query, transaction: jest.fn(async fn => fn({ query })) };
  const service = new PayrollService(db as any, catalogs as any, {} as any, {} as any);
  jest.spyOn(service, 'get').mockImplementation(async (_company, id) => ({ ...documents.get(id), transmissions: [], files: [] } as any));
  const send = jest.spyOn(service, 'send').mockImplementation(async (_company, _actor, id) => {
    documents.get(id).status = 'ACCEPTED'; return { ...documents.get(id), transmissions: [], files: [] } as any;
  });
  return { service, documents, sources, send, catalogs, query };
}
describe('persistencia del envío mensual', () => {
  it('registra el empleado y la causa si falla antes de preparar la transmisión', async () => {
    const { service, sources, catalogs, send } = harness();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const startLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    catalogs.getPayrollPeriodId.mockRejectedValueOnce(new Error('No se encontró el período de nómina en NextPyme.'));
    try {
      await expect(service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources))).rejects.toThrow('período');
      expect(startLog).toHaveBeenCalledWith(expect.stringContaining('[payroll] PREPARE_MONTH'));
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"stage":"CONSOLIDATE_MONTH"'));
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('"employee":"employee"'));
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('No se encontró el período'));
      expect(send).not.toHaveBeenCalled();
    } finally { errorLog.mockRestore(); startLog.mockRestore(); }
  });
  it('crea un documento mensual y vincula ambas quincenas sin cambiar sus importes o versiones', async () => {
    const { service, documents, sources, send, catalogs } = harness();
    const result = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    expect(result.accrued).toBe('2000.00');
    expect(result.state.monthlyConsolidation.generated).toBe(true);
    expect(send).toHaveBeenCalledWith(company, 'actor', result.id);
    expect(catalogs.getPayrollPeriodId).toHaveBeenCalledWith(company, 'Quincenal');
    expect(documents.get('source-1').state.monthlyDocumentId).toBe(result.id);
    expect(documents.get('source-1').updated_at).toBe(sources[0].updated_at);
    expect(documents.get('source-1').state.lines[0].amount).toBe('1000');
  });
  it('un segundo clic no vuelve a enviar el mensual aceptado', async () => {
    const { service, sources, send, documents } = harness();
    const expected = monthlyRevisions(sources);
    const first = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, expected);
    const second = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, expected);
    expect(second.id).toBe(first.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(documents.size).toBe(3);
  });
  it('reutiliza el documento de un mes completo sin crear otro con las mismas fechas', async () => {
    const { service, sources, send, documents } = harness(true);
    const result = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    expect(result.id).toBe('source-1'); expect(documents.size).toBe(1);
    expect(result.state.monthlyConsolidation.generated).toBe(false);
    expect(result.state.monthlyConsolidation.revisions).toEqual([{ id: 'source-1', updatedAt: '2026-11-12T00:00:00.000Z' }]);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('no consolida revisiones antiguas ni una selección incompleta', async () => {
    const { service, sources, send, documents } = harness();
    documents.get('source-2').updated_at = '2026-11-12T12:00:00.000Z';
    await expect(service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources))).rejects.toThrow('cambió');
    expect(send).not.toHaveBeenCalled(); expect(documents.size).toBe(2);
  });
  it('bloquea documentos enviados individualmente antes de crear otro mensual', async () => {
    const { service, sources, documents, send } = harness(); documents.get('source-1').number = 7;
    await expect(service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources))).rejects.toThrow('individualmente');
    expect(send).not.toHaveBeenCalled();
  });
  it('no permite consultar fuentes de otra empresa ni meses inválidos', async () => {
    const { service, sources, send } = harness();
    await expect(service.sendMonthlyEmployee('other-company', 'actor', '2026-10', employee, monthlyRevisions(sources))).rejects.toThrow('No hay períodos');
    await expect(service.sendMonthlyEmployee(company, 'actor', '2026-99', employee, [])).rejects.toThrow('mes válido');
    expect(send).not.toHaveBeenCalled();
  });
  it.each(['PROCESSING', 'UNCERTAIN'])('no reenvía un mensual %s', async status => {
    const { service, sources, send, documents } = harness();
    const first = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    documents.get(first.id).status = status; send.mockClear();
    expect((await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources))).status).toBe(status);
    expect(send).not.toHaveBeenCalled();
  });
  it('no reconstruye ni reenvía un mensual histórico reportado como procesado', async () => {
    const { service, sources, send, documents, query } = harness();
    const first = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    documents.get(first.id).status = 'REJECTED';
    const originalQuery = query.getMockImplementation()!;
    query.mockImplementation(async (sql: string, params: any[] = []) => sql.startsWith('SELECT response,validation,error FROM jarvis_payroll_transmissions')
      ? [{ response: { message: 'Regla: 90, documento procesado anteriormente' } }] : originalQuery(sql, params));
    jest.mocked(service.get).mockImplementation(async (_company, id) => ({ ...documents.get(id), status: 'UNCERTAIN', transmissions: [], files: [] } as any));
    send.mockClear();
    const result = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    expect(result.status).toBe('UNCERTAIN');
    expect(send).not.toHaveBeenCalled();
    expect(documents.get(first.id).status).toBe('REJECTED');
  });
  it('reconsolida un rechazo con valores corregidos y conserva el documento asignado', async () => {
    const { service, sources, send, documents } = harness();
    const first = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    documents.get(first.id).status = 'REJECTED'; documents.get(first.id).number = 9;
    documents.get('source-2').state.lines[0].amount = '1500'; documents.get('source-2').updated_at = '2026-11-12T12:00:00.000Z';
    const updated = sources.map(source => documents.get(source.id));
    const result = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(updated));
    expect(result.id).toBe(first.id); expect(result.number).toBe(9); expect(result.accrued).toBe('2500.00');
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('detecta cambios de fuentes entre la preparación y el envío real', async () => {
    const { service, sources, documents, query } = harness();
    const result = await service.sendMonthlyEmployee(company, 'actor', '2026-10', employee, monthlyRevisions(sources));
    documents.get('source-2').updated_at = '2026-11-12T12:30:00.000Z';
    await expect((service as any).verifyMonthlySources({ query }, company, documents.get(result.id))).rejects.toThrow('cambió');
  });
  it.each(['ACCEPTED', 'PROCESSING', 'UNCERTAIN'])('impide editar o añadir períodos al mes %s', async status => {
    const { service } = harness();
    const query = jest.fn(async () => [{ id: 'monthly', status }]);
    await expect((service as any).assertMonthlyEditable({ query }, company, employee, '2026-10')).rejects.toThrow('ya se envió');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), [company, employee, '2026-10']);
  });
});
