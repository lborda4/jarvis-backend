import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

function setup(document: Record<string, unknown> | null, sent = false) {
  const query = jest.fn(async (sql: string) => {
    if (sql.startsWith('SELECT * FROM jarvis_payroll_documents')) return document ? [document] : [];
    if (sql.startsWith('SELECT id FROM jarvis_payroll_transmissions')) return sent ? [{ id: 'transmission' }] : [];
    return [];
  });
  const db = { transaction: async (action: any) => action({ query }) };
  return { query, service: new PayrollService(db as any, {} as any, {} as any, {} as any) };
}

describe('eliminar nóminas sin envío', () => {
  it('elimina únicamente el borrador de la empresa activa y registra auditoría', async () => {
    const { query, service } = setup({ status: 'DRAFT', number: null });
    await expect(service.deleteDocument('company-a', 'actor', 'document-a')).resolves.toEqual({ deleted: true });
    expect(query).toHaveBeenCalledWith('SELECT * FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2 FOR UPDATE', ['company-a', 'document-a']);
    expect(query).toHaveBeenCalledWith('DELETE FROM jarvis_payroll_documents WHERE company_id=$1 AND id=$2', ['company-a', 'document-a']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jarvis_payroll_audit'), expect.arrayContaining(['DOCUMENT_DELETED', 'document-a']));
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });
  it('no permite eliminar un registro inexistente o de otra empresa', async () => {
    const { service, query } = setup(null);
    await expect(service.deleteDocument('company-b', 'actor', 'document-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
  it.each(['PENDING', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'UNCERTAIN'])('rechaza el estado %s', async status => {
    const { service, query } = setup({ status });
    await expect(service.deleteDocument('company-a', 'actor', 'document-a')).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
  it.each([{ sent_at: '2026-10-28' }, { number: '1' }, { cune: 'previous-cune' }])('conserva borradores con evidencia de envío %j', async evidence => {
    const { service, query } = setup({ status: 'DRAFT', ...evidence });
    await expect(service.deleteDocument('company-a', 'actor', 'document-a')).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
  it('conserva documentos editados que tienen transmisiones anteriores', async () => {
    const { service, query } = setup({ status: 'DRAFT', number: null }, true);
    await expect(service.deleteDocument('company-a', 'actor', 'document-a')).rejects.toBeInstanceOf(ConflictException);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
  });
});
