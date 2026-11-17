import { PayrollPayslipsService } from './payroll-payslips.service';
import { PayrollPayslipsController } from './payroll-payslips.controller';
import { PayrollGuard } from './payroll.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import AdmZip from 'adm-zip';

const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const request = '33333333-3333-4333-8333-333333333333';
const record = (document = id) => ({ id: document, employee_id: document, original_id: null, submissionStatus: 'ACCEPTED', recipientEmail: `${document}@example.com`,
  employee_snapshot: { firstName: document === id ? 'Ana' : 'Luis', surname: 'Pérez', identification: document, email: 'antiguo@example.com' },
  state: { startDate: '2026-01-01', endDate: '2026-01-15', payrollGroupId: 'group', lines: [] }, parameter_snapshot: { concepts: [] } });
function setup(rows = [record()]) {
  const query = jest.fn().mockResolvedValue(rows);
  const mail = { sendPayrollPayslip: jest.fn().mockResolvedValue(true) };
  const service = new PayrollPayslipsService({ query } as never, mail as never);
  const render = jest.spyOn(service as any, 'render').mockImplementation(async (_company: string, row: any) => ({ filename: `Desprendible-${row.id}.pdf`, buffer: Buffer.from(`%PDF-${row.employee_snapshot.firstName}`) }));
  return { service, query, mail, render };
}
describe('desprendibles por período y empleado', () => {
  it('protege los endpoints con el guard de nómina', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PayrollPayslipsController)).toContain(PayrollGuard);
  });
  it('consulta solamente documentos propios y devuelve el correo actual del empleado', async () => {
    const { service, query } = setup();
    expect(await service.recipients('company', [id])).toEqual([{ id, name: 'Ana Pérez', identification: id, email: `${id}@example.com`, canEmail: true }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE d.company_id=$1'), ['company', [id]]);
    expect(query.mock.calls[0][0]).toContain('e.company_id=d.company_id');
    expect(query.mock.calls[0][0]).toContain('m.company_id=d.company_id');
  });
  it('no usa el correo histórico si el empleado no tiene correo configurado', async () => {
    const { service, mail, render } = setup([{ ...record(), recipientEmail: '' }]);
    expect((await service.recipients('company', [id]))[0].canEmail).toBe(false);
    await expect(service.email('company', id, request)).rejects.toThrow('correo válido');
    expect(mail.sendPayrollPayslip).not.toHaveBeenCalled(); expect(render).not.toHaveBeenCalled();
  });
  it('rechaza documentos ajenos y nunca genera ni envía sus PDF', async () => {
    const { service, render, mail } = setup([]);
    await expect(service.pdf('company', id)).rejects.toThrow('no pertenece');
    await expect(service.zip('company', [id])).rejects.toThrow('no pertenece');
    await expect(service.email('company', id, request)).rejects.toThrow('no pertenece');
    expect(render).not.toHaveBeenCalled(); expect(mail.sendPayrollPayslip).not.toHaveBeenCalled();
  });
  it.each(['DRAFT', 'REJECTED', 'PROCESSING', 'UNCERTAIN'])('no distribuye una nómina %s', async submissionStatus => {
    const { service, render } = setup([{ ...record(), submissionStatus }]);
    await expect(service.zip('company', [id])).rejects.toThrow('aceptado');
    expect(render).not.toHaveBeenCalled();
  });
  it('no mezcla períodos en una descarga', async () => {
    const second = record(other); second.state.endDate = '2026-01-31';
    const { service, render } = setup([record(), second]);
    await expect(service.zip('company', [id, other])).rejects.toThrow('mismo período');
    expect(render).not.toHaveBeenCalled();
  });
  it('genera un ZIP con un PDF separado por cada seleccionado', async () => {
    const { service } = setup([record(), record(other)]);
    const file = await service.zip('company', [id, other]);
    expect(file.filename).toBe('Desprendibles-2026-01-01-2026-01-15.zip');
    const archive = new AdmZip(file.buffer);
    expect(archive.getEntries()).toHaveLength(2);
    expect(archive.readAsText(`Desprendible-${id}.pdf`)).toBe('%PDF-Ana');
    expect(archive.readAsText(`Desprendible-${other}.pdf`)).toBe('%PDF-Luis');
  });
  it('envía únicamente el PDF del empleado a su correo y evita repetir una solicitud', async () => {
    const { service, mail, render } = setup();
    await Promise.all([service.email('company', id, request), service.email('company', id, request)]);
    expect(mail.sendPayrollPayslip).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(mail.sendPayrollPayslip).toHaveBeenCalledWith(`${id}@example.com`, expect.objectContaining({ subject: expect.stringContaining('2026-01-01') }), { filename: `Desprendible-${id}.pdf`, content: Buffer.from('%PDF-Ana').toString('base64') }, expect.stringContaining(request));
  });
  it('no declara éxito sin confirmación y conserva el mismo adjunto para reintentar', async () => {
    const { service, mail, render } = setup();
    mail.sendPayrollPayslip.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(service.email('company', id, request)).rejects.toThrow('No se confirmó');
    await expect(service.email('company', id, request)).resolves.toEqual({ sent: true });
    expect(render).toHaveBeenCalledTimes(1);
    expect(mail.sendPayrollPayslip.mock.calls[0]).toEqual(mail.sendPayrollPayslip.mock.calls[1]);
  });
  it('escapa los nombres del empleado en el HTML del correo', async () => {
    const row = record(); row.employee_snapshot.firstName = '<script>bad</script>';
    const { service, mail } = setup([row]);
    await service.email('company', id, request);
    const template = mail.sendPayrollPayslip.mock.calls[0][1];
    expect(template.html).toContain('&lt;script&gt;'); expect(template.html).not.toContain('<script>');
  });
  it.each([[], [id, id], ['invalid'], null])('rechaza selecciones inválidas antes de consultar: %j', async ids => {
    const { service, query } = setup();
    await expect(service.recipients('company', ids)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
