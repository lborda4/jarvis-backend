import { BadGatewayException } from '@nestjs/common';
import { Company } from '../../../company/entities/company.entity';
import { IntegrationProvider } from '../../enums/integration-provider.enum';
import { SubscriptionStatus } from '../../../plan/enums/subscription-status.enum';
import { NextPymePackageRejectedException } from '../nextpyme/nextpyme-api.client';
import { creditUnlimitedNote } from './unlimited-note-credit';

function setup() {
  const credits = new Map<string,string>();
  const integration = { provider: IntegrationProvider.JARVIS, subscriptionStatus: SubscriptionStatus.ACTIVE,
    company: { nit: '900123456-7' }, plan: { id: 'plan', documentLimit: 50 },
    subscriptionStartedAt: new Date('2026-01-01'), createdAt: new Date('2026-01-01'),
    jarvisCertificateTerm: { startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z', checkedAt: '2026-01-01T00:00:00Z' } };
  const companies = { findOne: jest.fn().mockResolvedValue({ nextPymeToken: 'platform-token' }) };
  const db = { getRepository: jest.fn(entity => entity === Company ? companies : { findOne: jest.fn().mockResolvedValue(integration) }),
    query: jest.fn(async (sql:string, args:unknown[]) => {
      const key = args[0] + ':' + args[1];
      if (sql.startsWith('INSERT')) { if(credits.has(key))return []; credits.set(key,'PROCESSING'); return [{status:'PROCESSING'}]; }
      if (sql.startsWith('SELECT'))return [{status:credits.get(key)}];
      credits.set(key,args[2] as string); return [];
    }) };
  const api = { assignDocumentPackage: jest.fn().mockResolvedValue({ success: true }) };
  const credit = (company='company', key='CREDIT_NOTE:NC:1', issuedAt?:Date) => creditUnlimitedNote(db as never, api as never, company, key, issuedAt);
  return { credits, db, api, integration, companies, credit };
}
beforeEach(()=>jest.useFakeTimers({now:new Date('2026-11-22T17:00:00Z')}));
afterEach(()=>jest.useRealTimers());
it('abona una unidad al NIT correcto con el token emisor',async()=>{
  const {credit,api}=setup(); expect(await credit()).toBe('APPLIED');
  expect(api.assignDocumentPackage).toHaveBeenCalledWith({ user_identification_number:900123456,
    absolut_start_plan_date:'2026-11-22 12:00:00',absolut_documents:1 },'platform-token');
});
it('deduplica dos confirmaciones concurrentes de la misma nota',async()=>{
  const {credit,api}=setup(); await Promise.all([credit(),credit()]); await credit();
  expect(api.assignDocumentPackage).toHaveBeenCalledTimes(1);
});
it('notas distintas generan créditos separados',async()=>{
  const {credit,api}=setup(); await credit(); await credit('company','DEBIT_NOTE:ND:1');
  expect(api.assignDocumentPackage).toHaveBeenCalledTimes(2);
});
it('un timeout queda incierto y no duplica el abono al reintentar',async()=>{
  const {credit,api}=setup(); api.assignDocumentPackage.mockRejectedValue(new BadGatewayException());
  expect(await credit()).toBe('UNCERTAIN'); expect(await credit()).toBe('UNCERTAIN');
  expect(api.assignDocumentPackage).toHaveBeenCalledTimes(1);
});
it('un rechazo explícito conserva FAILED',async()=>{
  const {credit,api}=setup(); api.assignDocumentPackage.mockRejectedValue(new NextPymePackageRejectedException('Rechazado'));
  expect(await credit()).toBe('FAILED');
});
it('no abona documentos en una suscripción vencida',async()=>{
  const {credit,api,integration}=setup(); integration.jarvisCertificateTerm.endsAt='2026-01-02T00:00:00Z';
  expect(await credit()).toBe('SKIPPED'); expect(api.assignDocumentPackage).not.toHaveBeenCalled();
});
it('no abona notas de un ciclo anterior tras renovar',async()=>{
  const {credit,api}=setup(); expect(await credit('company','PAYROLL_ADJUSTMENT:old',new Date('2025-11-22'))).toBe('SKIPPED');
  expect(api.assignDocumentPackage).not.toHaveBeenCalled();
});
it('un fallo local no convierte la emisión confirmada en error',async()=>{
  const {credit,db,api}=setup(); db.query.mockRejectedValue(new Error('database unavailable'));
  await expect(credit()).resolves.toBe('FAILED'); expect(api.assignDocumentPackage).not.toHaveBeenCalled();
});
