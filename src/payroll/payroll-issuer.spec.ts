import { payrollIssuerErrors, type PayrollIssuerConfiguration } from './payroll-issuer';
const issuer: PayrollIssuerConfiguration = { identificationNumber: '900123456', payrollEnvironment: 1, payrollSoftwareConfigured: true, payrollPinConfigured: true };
it.each([1, 2])('acepta el NIT base y un ambiente de nómina explícito %s sin cambiarlo', payrollEnvironment => {
  expect(payrollIssuerErrors('900.123.456-7', { ...issuer, payrollEnvironment })).toEqual([]);
});
it('rechaza un NIT remoto con DV o el token de otra empresa', () => {
  expect(payrollIssuerErrors('900123456', { ...issuer, identificationNumber: '900123456-7' }).join()).toContain('NIE033');
  expect(payrollIssuerErrors('900123456', { ...issuer, identificationNumber: '999999999' }).join()).toContain('NIT diferente');
});
it('requiere los datos específicos de nómina sin inventar habilitación ni secretos', () => {
  const errors = payrollIssuerErrors('900123456', { ...issuer, payrollEnvironment: null, payrollSoftwareConfigured: false, payrollPinConfigured: false });
  expect(errors).toHaveLength(2);
  expect(errors.join()).toContain('payroll_type_environment_id');
  expect(errors.join()).toContain('NIE020');
});
