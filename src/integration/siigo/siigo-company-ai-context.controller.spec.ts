import { SiigoCompanyAiContextController } from './siigo-company-ai-context.controller';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { PlanSubscriptionService } from '../../plan/plan-subscription.service';
describe('company AI settings access and persistence', () => {
  const user = {
    companyId: 'company-1',
    userId: 'user-1',
    email: 'test@example.com',
  };
  function setup(enabled = true) {
    const companies = {
      findById: jest
        .fn()
        .mockResolvedValue({
          id: 'company-1',
          description: 'Descripción de Admin',
        }),
      save: jest.fn().mockImplementation(async (company) => company),
    };
    const subscriptions = {
      getSubscription: jest
        .fn()
        .mockResolvedValue({
          includedDocumentTypes: enabled
            ? ['PURCHASE_INVOICE']
            : ['SUPPORT_DOCUMENT'],
        }),
    };
    return {
      companies,
      subscriptions,
      controller: new SiigoCompanyAiContextController(
        companies as unknown as CompaniesRepository,
        subscriptions as unknown as PlanSubscriptionService,
      ),
    };
  }
  it('reads the existing admin description for the authenticated company', async () => {
    const { controller, companies, subscriptions } = setup();
    expect(await controller.get(user)).toEqual({
      description: 'Descripción de Admin',
      rules: [],
    });
    expect(companies.findById).toHaveBeenCalledWith('company-1');
    expect(subscriptions.getSubscription).toHaveBeenCalledWith(
      'company-1',
      'SIIGO',
    );
  });
  it('stores description and rules together, ignoring any supplied company ID', async () => {
    const { controller, companies } = setup();
    const request = {
      companyId: 'other',
      description: ' Jardín ',
      rules: [' Alimentos: almuerzos '],
    };
    expect(await controller.save(user, request)).toEqual({
      description: 'Jardín',
      rules: ['Alimentos: almuerzos'],
    });
    expect(companies.save).toHaveBeenCalledWith({
      id: 'company-1',
      description: { description: 'Jardín', rules: ['Alimentos: almuerzos'] },
    });
  });
  it('rejects companies without purchase invoices', async () => {
    const { controller, companies } = setup(false);
    await expect(controller.get(user)).rejects.toThrow();
    await expect(
      controller.save(user, { description: '', rules: [] }),
    ).rejects.toThrow();
    expect(companies.save).not.toHaveBeenCalled();
  });
  it('rejects an eleventh rule without writing', async () => {
    const { controller, companies } = setup();
    await expect(
      controller.save(user, {
        description: '',
        rules: Array(11).fill('regla'),
      }),
    ).rejects.toThrow();
    expect(companies.save).not.toHaveBeenCalled();
  });
});
