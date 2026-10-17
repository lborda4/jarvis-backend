import { buildJarvisDocumentEmail } from './jarvis-document-email.helper';

describe('JARVIS document email', () => {
  it('mueve la marca al footer con logo y contactos pequenos', () => {
    const result = buildJarvisDocumentEmail({ issuerName: 'Empresa SAS', issuerNit: '900123456', receiverName: 'Cliente', documentNumber: 'FE1', issueDate: '2026-10-16', total: 100, currency: 'COP', documentKind: 'ELECTRONIC_INVOICE' });
    expect(result.html_header).toContain('Empresa SAS');
    expect(result.html_header).not.toContain('<img');
    expect(result.html_header).not.toContain('JARVIS');
    expect(result.html_header).not.toContain('AUTOMATIZA');
    expect(result.html_footer).toContain("width='28'");
    expect(result.html_footer).toContain("alt='JARVIS'");
    expect(result.html_footer).toContain('font-size:14px');
    expect(result.html_footer).toContain('font-size:10px');
    expect(result.html_footer).toContain('mailto:gerencia@jarviscol.com');
    expect(result.html_footer).toContain('tel:+573195355387');
    expect(result.html_footer).toContain('3195355387');
    expect(JSON.stringify(result)).not.toContain('{{');
  });

  it('renders the supplied design with document values and escaped names', () => {
    const result = buildJarvisDocumentEmail({
      issuerName: 'Empresa & SAS',
      issuerNit: '900123456',
      receiverName: '<Cliente>',
      documentNumber: 'NDS12',
      issueDate: '2026-10-12',
      total: 238000,
      currency: 'COP',
      documentKind: 'SUPPORT_CREDIT_NOTE',
      cufe: 'abc&123',
    });
    expect(result.html_body).toContain('Empresa &amp; SAS');
    expect(result.html_body).toContain('&lt;Cliente&gt;');
    expect(result.html_body).toContain('Nota de ajuste de documento soporte');
    expect(result.html_body).toContain('238.000,00 COP');
    expect(result.html_body).toContain('NDS12');
    expect(result.html_buttons).toBe('');
    expect(result.html_body).toContain('Ver comprobante');
    expect(result.html_body).toContain('documentkey=abc%26123');
    expect(result.html_body).toContain('12 de octubre de 2026');
    expect(JSON.stringify(result)).not.toContain('{{');
  });

  it('omits the document link when DIAN has not returned a unique code', () => {
    expect(
      buildJarvisDocumentEmail({
        issuerName: 'Empresa',
        issuerNit: '1',
        receiverName: 'Cliente',
        documentNumber: 'FE1',
        issueDate: '2026-10-12',
        total: 0,
        currency: 'USD',
      }).html_buttons,
    ).toBe('');
  });
});
