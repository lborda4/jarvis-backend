import { of } from 'rxjs';
import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';

function lookup(payload: unknown) {
  const http = {
    post: jest.fn((url: string) =>
      of({
        status: 200,
        data: url.endsWith('/reports/master/database')
          ? {
              type_documents: [
                { id: 3, code: 'CC', name: 'Cédula de ciudadanía' },
              ],
            }
          : payload,
      }),
    ),
  };
  const config = {
    get: jest.fn().mockReturnValue('https://nextpyme.example.invalid'),
  };
  return new NextPymeRutService(http as never, config as never).lookupDocument(
    JarvisDocumentType.CC,
    '12345678',
    'company-token',
  );
}

describe('ubicación de la consulta NextPyme por documento', () => {
  it('devuelve nombres, correo, dirección e ID interno del municipio', async () => {
    expect(
      await lookup({
        data: {
          identification_number: '12345678',
          nombre: 'PEREZ GOMEZ ANA',
          email: 'ana@correo.com',
          direccion: 'Calle 1',
          municipality_id: 149,
        },
      }),
    ).toMatchObject({
      found: true,
      name: 'PEREZ GOMEZ ANA',
      email: 'ana@correo.com',
      address: 'Calle 1',
      municipalityId: 149,
      cityCode: null,
    });
  });
  it('considera una respuesta de solo ciudad como datos encontrados', async () => {
    expect(
      await lookup({
        data: { city_code: '05001', city_name: 'Medellín', state_code: '05' },
      }),
    ).toMatchObject({
      found: true,
      cityCode: '05001',
      cityName: 'Medellín',
      stateCode: '05',
      municipalityId: null,
    });
  });
  it('no interpreta IDs internos como códigos DANE', async () => {
    expect(
      await lookup({ municipality_id: '149', department_id: 4 }),
    ).toMatchObject({
      found: true,
      municipalityId: 149,
      cityCode: null,
      stateCode: null,
    });
  });
  it.each([0, -1, 'no aplica', 'Infinity', '9007199254740992'])(
    'ignora un ID de municipio inválido: %s',
    (municipality_id) => {
      return expect(lookup({ municipality_id })).resolves.toMatchObject({
        found: false,
        municipalityId: null,
        cityCode: null,
      });
    },
  );
  it('acepta datos de ubicación anidados en respuestas serializadas', async () => {
    expect(
      await lookup({
        response: JSON.stringify({
          correo: 'ana@correo.com',
          direccion: 'Carrera 8',
          city_name: 'Bogotá',
          municipality_id: '149',
        }),
      }),
    ).toMatchObject({
      found: true,
      email: 'ana@correo.com',
      address: 'Carrera 8',
      cityName: 'Bogotá',
      municipalityId: 149,
    });
  });
});
