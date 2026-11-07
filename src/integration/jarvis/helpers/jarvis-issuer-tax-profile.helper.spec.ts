import { issuerTaxProfile } from './jarvis-issuer-tax-profile.helper';

it('captura actividad completa y tarifa ICA sin que cambien con la configuración', () => {
  const credentials = { economic_activity: '1410 - Confección de prendas de vestir, excepto prendas de piel', ica_rate: 4.14 };
  const saved = issuerTaxProfile(credentials, 'emission');
  credentials.ica_rate = 7.66; credentials.economic_activity = '4923';
  expect(saved).toMatchObject({ economicActivity: '1410 - Confección de prendas de vestir, excepto prendas de piel', icaRate: 4.14, source: 'emission' });
});
it('captura cero cuando no se configura la tarifa de ICA', () => {
  expect(issuerTaxProfile({ economic_activity: '1410' }, 'emission')).toMatchObject({ icaRate: 0 });
});
