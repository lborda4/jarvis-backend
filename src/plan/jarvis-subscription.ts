import type { Integration } from '../integration/entities/integration.entity';
import { companyDueDate, trackingToday } from '../admin/company-tracking';
import type { JarvisTopUp } from './jarvis-top-ups';
import { randomUUID } from 'crypto';

export interface JarvisDocumentCycle { id: string; startedAt: string; }

export function startJarvisDocumentCycle(integration: Integration, now = new Date()) {
  integration.jarvisDocumentCycle = { id: randomUUID(), startedAt: now.toISOString() };
}

export function jarvisConsumptionStart(integration: Integration): Date {
  const period = jarvisSubscriptionPeriod(integration);
  const cycle = integration.jarvisDocumentCycle;
  return cycle && new Date(cycle.startedAt) > period.start ? new Date(cycle.startedAt) : period.start;
}

export interface JarvisTopUpOperation {
  id: string;
  periodStart: string;
  createdAt: string;
  status: 'PROCESSING' | 'APPLIED' | 'FAILED' | 'UNCERTAIN';
  topUps: JarvisTopUp[];
  initialDocuments?: number;
  cycleId?: string;
}

/** A recharge belongs to the subscription period; it never starts a new one. */
export function jarvisSubscriptionPeriod(integration: Integration, now = new Date()) {
  const certificate = integration.jarvisCertificateTerm;
  if (certificate) {
    const start = new Date(certificate.startsAt);
    const end = new Date(certificate.endsAt);
    return { start, key: trackingToday(start), end, expired: now >= end, notStarted: now < start };
  }
  const renewal = integration.company?.trackingPeriodStart;
  const start = renewal && renewal <= trackingToday(now)
    ? new Date(renewal + 'T00:00:00-05:00')
    : integration.subscriptionStartedAt ?? integration.createdAt;
  const key = trackingToday(start);
  const dueDate = integration.plan?.commercialTerms?.billingMonths === 12 ? companyDueDate(start, 12) : null;
  const end = dueDate ? new Date(dueDate + 'T00:00:00-05:00') : null;
  return { start, key, end, expired: end !== null && now >= end, notStarted: false };
}

export function jarvisDocumentLimit(integration: Integration): number | null {
  const period = jarvisSubscriptionPeriod(integration);
  if (period.expired || period.notStarted) return 0;
  const base = integration.plan?.documentLimit ?? null;
  if (base === null) return null;
  const credits = (integration.topUpOperations ?? [])
    .filter(operation => operation.status === 'APPLIED' && (integration.jarvisDocumentCycle
      ? operation.cycleId === integration.jarvisDocumentCycle.id
      : integration.jarvisCertificateTerm
      ? new Date(operation.createdAt) >= period.start && new Date(operation.createdAt) < period.end!
      : operation.periodStart === period.key))
    .flatMap(operation => operation.topUps)
    .filter(item => item.kind === 'DOCUMENTS')
    .reduce((sum, item) => sum + item.units, 0);
  return base + credits;
}
