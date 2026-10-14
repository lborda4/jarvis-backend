import { parseRadianEventResult } from './nextpyme-radian-result';

describe('RADIAN response metadata', () => {
  it('extracts CUDE and the nested DIAN result', () => {
    const response = {
      success: true,
      ResponseDian: {
        Envelope: {
          Body: {
            SendEventUpdateStatusResponse: {
              SendEventUpdateStatusResult: {
                IsValid: 'true',
                StatusCode: '00',
                XmlDocumentKey: 'event-cude',
                StatusMessage: 'Autorizado',
              },
            },
          },
        },
      },
    };
    expect(parseRadianEventResult(response, 200)).toMatchObject({
      status: 'sent',
      cude: 'event-cude',
      dianCode: '00',
      message: 'Autorizado',
      response,
    });
  });
  it('keeps the DIAN rejection reason and the returned CUDE', () => {
    expect(
      parseRadianEventResult(
        {
          success: true,
          cude: 'rejected-cude',
          ResponseDian: {
            IsValid: 'false',
            StatusCode: '99',
            ErrorMessage: { string: 'Regla LGC62' },
          },
        },
        200,
      ),
    ).toMatchObject({
      status: 'failed',
      cude: 'rejected-cude',
      message: 'Regla LGC62',
    });
  });
  it('requires reconciliation for a duplicate rather than treating it as a rejected event', () => {
    expect(
      parseRadianEventResult(
        {
          success: false,
          message: 'Ya se registro este evento para este documento.',
          cude: 'previous-cude',
        },
        200,
      ),
    ).toMatchObject({ status: 'unknown', cude: 'previous-cude' });
  });
});
