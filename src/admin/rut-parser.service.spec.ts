import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { JarvisTaxRegime } from '../integration/jarvis/enums/jarvis-tax-regime.enum';
import { JarvisTaxResponsibility } from '../integration/jarvis/enums/jarvis-tax-responsibility.enum';
import { JarvisVatRegime } from '../integration/jarvis/enums/jarvis-vat-regime.enum';
import { RutParserService } from './rut-parser.service';

describe('RutParserService', () => {
  const service = new RutParserService();

  const naturalRut = `Registro Único Tributario - RUT - DIAN
Actualización 0 2
141261811532
1 0 1 6 1 0 5 6 0 7 1 Impuestos de Bogotá 3 2
Persona natural o sucesión ilíquida 2 Cédula de Ciudadanía 1 3 1 0 1 6 1 0 5 6 0 7
COLOMBIA 1 6 9 Bogotá D.C. 1 1 Bogotá, D.C. 0 0 1
PEREZ\tGOMEZ\tJUAN\tCAMILO
COLOMBIA 1 6 9 Cundinamarca 2 5 Soacha 7 5 4
CL 2 A 6 A 54
persona@example.com
3 0 0 1 2 3 4 5 6 7
4 9 2 3 2 0 2 6 0 7 0 1 6 8 2 0 2 0 2 5 1 0 0 1 8 2 9 9
05- Impto. renta y compl. régimen ordinar
49 - No responsable de IVA
-- 1 of 1 --`;

  it('lee una persona natural sin razón social y usa su domicilio, no el lugar de expedición', () => {
    expect(service.parseText(naturalRut)).toMatchObject({
      nit: '1016105607', verificationDigit: '1',
      name: 'PEREZ GOMEZ JUAN CAMILO', personType: CompanyPersonType.NATURAL_PERSON,
      responsibleName: 'PEREZ GOMEZ JUAN CAMILO',
      jarvisCredentials: {
        person_type: CompanyPersonType.NATURAL_PERSON,
        business_name: 'JUAN CAMILO PEREZ GOMEZ',
        given_names: 'JUAN CAMILO', surnames: 'PEREZ GOMEZ',
        department: 'Cundinamarca', municipality: 'Soacha', city: 'Soacha',
        economic_activity: '4923', vat_regime: JarvisVatRegime.NON_RESPONSIBLE,
        tax_regime: JarvisTaxRegime.COMMON,
      },
      warnings: [],
    });
  });

  it('admite un NIT en una línea separada del nombre de la seccional', () => {
    expect(service.parseText(naturalRut.replace('1 Impuestos', '1\nImpuestos')).nit).toBe('1016105607');
  });

  it('pide confirmar nombres ambiguos sin rechazar el RUT ni adivinar su separación', () => {
    const result = service.parseText(naturalRut.replace('PEREZ\tGOMEZ\tJUAN\tCAMILO', 'DE LA TORRE JUAN'));
    expect(result.name).toBe('DE LA TORRE JUAN');
    expect(result.jarvisCredentials.given_names).toBeNull();
    expect(result.jarvisCredentials.surnames).toBeNull();
    expect(result.warnings).toContain('Complete o confirme los nombres y apellidos de la persona natural.');
  });

  it('permite completar manualmente una identidad natural que no pudo leerse', () => {
    const result = service.parseText(naturalRut.replace('PEREZ\tGOMEZ\tJUAN\tCAMILO\n', ''));
    expect(result.personType).toBe(CompanyPersonType.NATURAL_PERSON);
    expect(result.name).toBe('');
    expect(result.warnings).toContain('Complete o confirme los nombres y apellidos de la persona natural.');
  });

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
