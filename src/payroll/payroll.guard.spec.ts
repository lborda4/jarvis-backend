import { PayrollGuard } from './payroll.guard';
describe('permisos de nómina por empresa', () => {
  const context = (companyId: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { companyId, userId: 'actor' } }),
      }),
    }) as any;
  it('rechaza empresas sin integración JARVIS activa', async () => {
    const guard = new PayrollGuard({
      query: jest.fn().mockResolvedValue([]),
    } as any);
    await expect(guard.canActivate(context('company-a'))).rejects.toThrow(
      'JARVIS activa',
    );
  });
  it('consulta exclusivamente la empresa autenticada', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'integration' }]);
    const guard = new PayrollGuard({ query } as any);
    await expect(guard.canActivate(context('company-a'))).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "company_id=$1 AND provider='JARVIS' AND active=true",
      ),
      ['company-a'],
    );
  });
});
