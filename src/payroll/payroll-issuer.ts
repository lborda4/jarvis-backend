export interface PayrollIssuerConfiguration {
  identificationNumber: string | null;
  payrollEnvironment: number | null;
  payrollSoftwareConfigured: boolean;
  payrollPinConfigured: boolean;
}

export function payrollIssuerErrors(localNit: string | null | undefined, issuer: PayrollIssuerConfiguration): string[] {
  const errors: string[] = [];
  const nit = localNit?.replace(/[.\s]/g, '').replace(/-\d$/, '');
  if (!nit || !/^\d+$/.test(nit)) errors.push('Completa el NIT de la empresa antes de enviar la nómina.');
  if (!issuer.identificationNumber || !/^\d+$/.test(issuer.identificationNumber))
    errors.push('Revisa el NIT del empleador en NextPyme: debe contener solo números, sin guiones ni dígito de verificación (NIE033).');
  else if (nit && nit !== issuer.identificationNumber)
    errors.push('El token de NextPyme corresponde a un NIT diferente al de esta empresa. Corrige la configuración del emisor antes de enviar la nómina (NIE033).');
  if (![1, 2].includes(issuer.payrollEnvironment ?? 0))
    errors.push('Configura el ambiente de nómina en NextPyme: payroll_type_environment_id debe ser 1 (producción) o 2 (pruebas). El ambiente de facturación es independiente.');
  if (!issuer.payrollSoftwareConfigured || !issuer.payrollPinConfigured)
    errors.push('Configura el ID y el PIN del software de nómina en NextPyme. Los datos del software de facturación no reemplazan los de nómina (NIE020).');
  return errors;
}
