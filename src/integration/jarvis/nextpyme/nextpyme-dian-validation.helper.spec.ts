import { parseDianValidationResult } from './nextpyme-dian-validation.helper';

describe('parseDianValidationResult', () => {
  it('detecta un documento rechazado por la DIAN (caso real reportado)', () => {
    const response = {
      success: true,
      message: 'AttachedDocument #SEDS984000005 generada con éxito',
      ResponseDian: {
        Envelope: {
          Body: {
            SendBillSyncResponse: {
              SendBillSyncResult: {
                ErrorMessage: {
                  string:
                    'Regla: 90, Rechazo: Documento procesado anteriormente.',
                },
                IsValid: 'false',
                StatusCode: '99',
                StatusDescription:
                  'Validación contiene errores en campos mandatorios.',
                StatusMessage: 'Documento con errores en campos mandatorios.',
              },
            },
          },
        },
      },
    };

    const result = parseDianValidationResult(response);

    expect(result).not.toBeNull();
    expect(result?.isValid).toBe(false);
    expect(result?.statusCode).toBe('99');
    expect(result?.errorMessage).toBe(
      'Regla: 90, Rechazo: Documento procesado anteriormente.',
    );
    expect(result?.statusDescription).toBe(
      'Validación contiene errores en campos mandatorios.',
    );
  });

  it('reconoce un documento válido (IsValid: "true")', () => {
    const response = {
      success: true,
      ResponseDian: {
        Envelope: {
          Body: {
            SendBillSyncResponse: {
              SendBillSyncResult: {
                IsValid: 'true',
                StatusCode: '00',
                StatusDescription: 'Documento validado por la DIAN',
              },
            },
          },
        },
      },
    };

    const result = parseDianValidationResult(response);

    expect(result?.isValid).toBe(true);
    expect(result?.errorMessage).toBeNull();
  });

  it('junta ErrorMessage cuando viene como array de varios strings', () => {
    const response = {
      ResponseDian: {
        Envelope: {
          Body: {
            SendBillSyncResponse: {
              SendBillSyncResult: {
                IsValid: 'false',
                ErrorMessage: { string: ['Primer error', 'Segundo error'] },
              },
            },
          },
        },
      },
    };

    const result = parseDianValidationResult(response);

    expect(result?.errorMessage).toBe('Primer error | Segundo error');
  });

  it('devuelve null cuando la respuesta no trae IsValid en ningún lado', () => {
    const response = {
      success: true,
      message: 'AttachedDocument generada con éxito',
      cuds: 'abc123',
    };

    expect(parseDianValidationResult(response)).toBeNull();
  });

  it('devuelve isValid null si el valor de IsValid no es reconocible', () => {
    const response = {
      SendBillSyncResult: { IsValid: 'unknown' },
    };

    const result = parseDianValidationResult(response);

    expect(result?.isValid).toBeNull();
  });
});
