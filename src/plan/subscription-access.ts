import { companyTrackingDueDate, trackingToday } from '../admin/company-tracking';
import type { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { jarvisSubscriptionPeriod } from './jarvis-subscription';

export function subscriptionAccess(integration: Integration, now = new Date()) {
  const jarvis = integration.provider === IntegrationProvider.JARVIS;
  const period = jarvis ? jarvisSubscriptionPeriod(integration, now) : null;
  const due = !jarvis && integration.company ? companyTrackingDueDate(integration.company) : null;
  const end = period?.end ?? (due ? new Date(due + 'T00:00:00-05:00') : null);
  const expired = end !== null && now >= end;
  const notStarted = period?.notStarted ?? false;
  const suspended = integration.subscriptionStatus === 'SUSPENDED' || integration.subscriptionStatus === 'CANCELLED';
  const daysRemaining = end ? Math.round((Date.parse(trackingToday(end)) - Date.parse(trackingToday(now))) / 86400000) : null;
  return { provider: integration.provider, startsAt: period?.start.toISOString() ?? integration.subscriptionStartedAt?.toISOString() ?? null,
    expiresAt: end?.toISOString() ?? null, expired, notStarted, canWrite: !expired && !notStarted && !suspended,
    daysRemaining, status: integration.subscriptionStatus };
}

export function isSubscriptionMutation(method: string, url: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return false;
  const path = url.split('?')[0].replace(/\/+$/, '');
  if (/^\/integrations\/jarvis\/(radian\/note-eligibility|terceros\/lookup-nit)$/.test(path)) return false;
  return /^\/(integrations|invoices|electronic-documents|products|payroll|import-sessions?|dian|bank-statements)(\/|$)/.test(path);
}
