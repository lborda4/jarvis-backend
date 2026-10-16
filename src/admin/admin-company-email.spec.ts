import { AdminService } from './admin.service';
import { UserRole } from '../auth/enums/user-role.enum';

describe('Admin company account email', () => {
  const link = (id: string, email: string, role = UserRole.USER, active = true) => ({
    id,
    createdAt: new Date(`2026-01-${id.padStart(2, '0')}`),
    user: { email, role, active },
  });

  async function listEmail(userCompanies: ReturnType<typeof link>[]) {
    const service = new AdminService(
      {} as never,
      { findAllWithIntegrations: async () => [{
        id: 'company', name: 'Empresa', createdAt: new Date(),
        responsible: { email: 'contact@example.com' },
        userCompanies,
      }] } as never,
      {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never,
    );
    return (await service.listCompanies('admin')).items[0];
  }

  it('uses the earliest active user account, excluding admins and inactive accounts', async () => {
    const company = await listEmail([
      link('1', 'admin@example.com', UserRole.ADMIN),
      link('2', 'inactive@example.com', UserRole.USER, false),
      link('4', 'later@example.com'),
      link('3', 'account@example.com'),
    ]);
    expect(company.email).toBe('account@example.com');
    expect(company.responsible?.email).toBe('contact@example.com');
  });

  it('returns null when no active user account is linked', async () => {
    expect((await listEmail([])).email).toBeNull();
    expect((await listEmail([link('1', 'admin@example.com', UserRole.ADMIN)])).email).toBeNull();
  });
});
