import { mapElectronicDocumentPayloadToSiigoSupplier } from './electronic-document-to-siigo-supplier.mapper';
import { ElectronicDocumentPayload } from '../../../electronic-document/interfaces/electronic-document-payload.interface';

function payload(cityCode?: string, stateCode?: string): ElectronicDocumentPayload {
  return { supplier: { name: 'PARROQUIA CRISTO RESUCITADO', documentType: 'NIT',
    documentNumber: '800165903', countryCode: 'Co', cityCode, stateCode },
  } as ElectronicDocumentPayload;
}

describe('Dirección del tercero SIIGO', () => {
  it.each([
    ['1111001', '11', '11001', '11'],
    ['11001', '11', '11001', '11'],
    ['0505001', '05', '05001', '05'],
    ['5001', '05', '05001', '05'],
    ['001', '5', '05001', '05'],
    ['05001', undefined, '05001', '05'],
    ['05001', '11', '05001', '05'],
  ])('normaliza ciudad %s y departamento %s solo para SIIGO', (city, state, expectedCity, expectedState) => {
    const source = payload(city, state);
    const result = mapElectronicDocumentPayloadToSiigoSupplier(source);
    expect(result.address?.city).toEqual({ country_code: 'Co', state_code: expectedState, city_code: expectedCity });
    expect(source.supplier.cityCode).toBe(city);
  });
  it('normaliza también la ciudad de respaldo de la empresa', () => {
    expect(mapElectronicDocumentPayloadToSiigoSupplier(payload(), undefined, { cityCode: '1111001' }).address?.city.city_code).toBe('11001');
  });
  it('rechaza un código malformado sin inventar una ciudad', () => {
    expect(() => mapElectronicDocumentPayloadToSiigoSupplier(payload('9911001', '11'))).toThrow('código DANE');
  });
  it('no transforma códigos extranjeros', () => {
    const source = payload('1234567', 'CA');
    source.supplier.countryCode = 'US';
    expect(mapElectronicDocumentPayloadToSiigoSupplier(source).address?.city).toEqual({ country_code: 'US', state_code: 'CA', city_code: '1234567' });
  });

  it('sanitiza # y N° para que SIIGO no rechace la dirección', () => {
    const source = payload('11001', '11');
    source.supplier.address = 'Calle 45 # 57 - 47 N° 2';

    expect(mapElectronicDocumentPayloadToSiigoSupplier(source).address?.address).toBe(
      'Calle 45 No. 57 - 47 No. 2',
    );
  });

  it('usa 0000 cuando la dirección queda vacía tras sanitizar', () => {
    const source = payload('11001', '11');
    source.supplier.address = '@@@';

    expect(mapElectronicDocumentPayloadToSiigoSupplier(source).address?.address).toBe(
      '0000',
    );
  });
});
