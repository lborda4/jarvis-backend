import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { JarvisTaxRegime } from '../integration/jarvis/enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../integration/jarvis/enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../integration/jarvis/enums/jarvis-vat-regime.enum';
import { RutParserService } from './rut-parser.service';

describe('RutParserService', () => {
  const service = new RutParserService();

  it('extracts the company and Jarvis fields from a DIAN RUT', () => {
    const result = service.parseText(`
      Registro Único Tributario - RUT - DIAN
      Inscripción 0 1
      141262271604
      9 0 2 0 8 6 4 6 0 6 Impuestos de Bogotá 3 2
      Persona jurídica 1
      JARVIS COLOMBIA S.A.S
      COLOMBIA 1 6 9 Bogotá D.C. 1 1 Bogotá, D.C. 0 0 1
      CALLE 48C SUR #25-44
      JOSLSILVAG283@GMAIL.COM
      1 1 0 6 1 1 3 1 9 5 3 5 5 3 8 7
      48 - Impuesto sobre las ventas - IVA
      05 - Impuesto de renta y complementario régimen ordinario
      CIIU 6201 Actividades de desarrollo de sistemas informáticos
      Cédula de Ciudadanía 1 3 1 0 3 2 5 0 4 9 0 4
      BORDA LAURA SOFIA
    `);

    expect(result).toMatchObject({
      nit: '902086460',
      verificationDigit: '6',
      name: 'JARVIS COLOMBIA S.A.S',
      personType: CompanyPersonType.LEGAL_ENTITY,
      address: 'CALLE 48C SUR #25-44',
      email: 'joslsilvag283@gmail.com',
      phone: '3195355387',
      responsibleName: 'BORDA LAURA SOFIA',
      jarvisCredentials: {
        business_name: 'JARVIS COLOMBIA S.A.S',
        tax_regime: JarvisTaxRegime.COMMON,
        vat_regime: JarvisVatRegime.RESPONSIBLE,
        tax_responsibility: JarvisTaxResponsibility.NOT_APPLICABLE,
        economic_activity:
          '6201 - Actividades de desarrollo de sistemas informáticos',
        country: 'Colombia',
        department: 'Bogotá D.C.',
        municipality: 'Bogotá, D.C.',
        city: 'Bogotá',
        email: 'joslsilvag283@gmail.com',
        address: 'CALLE 48C SUR #25-44',
        phone: '3195355387',
      },
      warnings: [],
    });
  });
});
