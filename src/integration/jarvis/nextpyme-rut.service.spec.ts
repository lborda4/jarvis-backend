import { NextPymeRutService } from './nextpyme-rut.service';
import { JarvisDocumentType } from './enums/jarvis-document-type.enum';

describe('NextPymeRutService company authentication', () => {
  it.each([undefined, '', '   '])('rejects a missing company token without using the global token (%s)', async token => {
    const http = { post: jest.fn() };
    const config = { get: jest.fn().mockReturnValue('global-token') };
    const service = new NextPymeRutService(http as any, config as any);
    await expect(service.lookupDocument(JarvisDocumentType.NIT, '900123456', token)).rejects.toThrow('token de NextPyme');
    expect(http.post).not.toHaveBeenCalled();
    expect(config.get).not.toHaveBeenCalled();
  });
});
