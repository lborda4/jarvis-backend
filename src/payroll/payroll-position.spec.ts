import { NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service';

function setup(exists = true) {
  const query = jest.fn(async (sql: string) => sql.startsWith('UPDATE jarvis_payroll_positions') && exists ? [{ id: 'position' }] : []);
  const db = { transaction: async (action: any) => action({ query }) };
  return { query, service: new PayrollService(db as any, {} as any, {} as any, {} as any) };
}
describe('eliminar cargos del catálogo', () => {
  it('inactiva el cargo de la empresa sin borrar las asignaciones existentes', async () => {
    const { service, query } = setup();
    await expect(service.deletePosition('company', 'actor', 'position')).resolves.toEqual({ deleted: true });
    expect(query).toHaveBeenCalledWith('UPDATE jarvis_payroll_positions SET active=false WHERE company_id=$1 AND id=$2 RETURNING id', ['company', 'position']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jarvis_payroll_audit'), expect.arrayContaining(['POSITION_DELETED', 'position']));
    expect(query.mock.calls.some(([sql]) => sql.startsWith('DELETE') || sql.includes('UPDATE jarvis_payroll_employees'))).toBe(false);
  });
  it('rechaza cargos inexistentes o pertenecientes a otra empresa', async () => {
    const { service, query } = setup(false);
    await expect(service.deletePosition('other-company', 'actor', 'position')).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.any(String), ['other-company', 'position']);
  });
});
