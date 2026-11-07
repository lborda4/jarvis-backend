import { BadRequestException } from '@nestjs/common';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';
import { INTEGRATION_POLICIES } from '../constants/integration-policies';

export function registrationPolicy(integrations: Array<{ provider: IntegrationProvider; active: boolean }> = []) {
  const active = integrations.filter(item => item.active).map(item => item.provider);
  const policyId = active.includes(IntegrationProvider.SIIGO)
    ? 'siigo-terms-2026-10-12-v1.1' : 'jarvis-terms-2026-10-08-v1';
  return { policyId, ...INTEGRATION_POLICIES[policyId] };
}

export function assertRegistrationPolicy(id: unknown, integrations: Array<{ provider: IntegrationProvider; active: boolean }> = []) {
  const policy = registrationPolicy(integrations);
  if (id !== policy.policyId) throw new BadRequestException({ code: 'REGISTRATION_POLICY_REQUIRED', message: 'Abre y acepta la política vigente de tu empresa antes de registrarte.' });
  return policy;
}
