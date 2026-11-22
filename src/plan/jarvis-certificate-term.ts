import { BadGatewayException } from '@nestjs/common';
import type { Integration } from '../integration/entities/integration.entity';
import { startJarvisDocumentCycle } from './jarvis-subscription';

export interface JarvisCertificateTerm {
  startsAt: string;
  endsAt: string;
  checkedAt: string;
}

/** NextPyme returns Colombia local time without an offset. Never keep the P12 password or raw response. */
export function parseJarvisCertificateTerm(response: unknown, now = new Date()): JarvisCertificateTerm {
  const root = response as { success?: boolean; certificates?: { expiration_date?: unknown }[] } | null;
  if (root?.success !== true || !Array.isArray(root.certificates)) throw invalidCertificate();
  const dates = root.certificates.flatMap(item => {
    if (typeof item?.expiration_date !== 'string') return [];
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(item.expiration_date.trim());
    if (!match) return [];
    const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
    const wallTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 1970 || wallTime.getUTCFullYear() !== year || wallTime.getUTCMonth() !== month - 1 || wallTime.getUTCDate() !== day ||
      wallTime.getUTCHours() !== hour || wallTime.getUTCMinutes() !== minute || wallTime.getUTCSeconds() !== second) return [];
    return [wallTime];
  });
  if (!dates.length) throw invalidCertificate();
  const expiration = new Date(Math.max(...dates.map(date => date.getTime())));
  const lastDay = new Date(Date.UTC(expiration.getUTCFullYear() - 1, expiration.getUTCMonth() + 1, 0)).getUTCDate();
  const beginning = new Date(Date.UTC(expiration.getUTCFullYear() - 1, expiration.getUTCMonth(), Math.min(expiration.getUTCDate(), lastDay),
    expiration.getUTCHours(), expiration.getUTCMinutes(), expiration.getUTCSeconds()));
  const colombiaOffset = 5 * 60 * 60 * 1000;
  return { startsAt: new Date(beginning.getTime() + colombiaOffset).toISOString(), endsAt: new Date(expiration.getTime() + colombiaOffset).toISOString(), checkedAt: now.toISOString() };
}

export function assignJarvisCertificateTerm(integration: Integration, term: JarvisCertificateTerm) {
  integration.jarvisCertificateTerm = term;
  integration.subscriptionStartedAt = new Date(term.startsAt);
  startJarvisDocumentCycle(integration);
}

function invalidCertificate() {
  return new BadGatewayException('NextPyme no devolvió una fecha de vencimiento válida del certificado digital. No se asignó el plan.');
}
