import { buildPasswordResetEmail } from './password-reset-email.helper';

describe('Correo de recuperación de contraseña Jarvis', () => {
  const url = 'https://www.jarviscol.com/restablecer-contrasena?token=test-token&source=email';
  it('mantiene el enlace completo en el botón, el respaldo y el texto plano', () => {
    const { html, text, subject } = buildPasswordResetEmail(url);
    expect(subject).toBe('Restablece tu contraseña en Jarvis');
    expect(html.match(/href="https:\/\/www.jarviscol.com\/restablecer-contrasena\?token=test-token&amp;source=email"/g)).toHaveLength(2);
    expect(html).toContain('Crear nueva contraseña');
    expect(text).toContain(url);
    expect(text).not.toContain('&amp;');
  });
  it('informa la vigencia, el uso único y qué hacer si no se solicitó el cambio', () => {
    const { html, text } = buildPasswordResetEmail(url);
    expect(html).toContain('45 minutos');
    expect(text).toContain('45 minutos');
    expect(text).toContain('una vez');
    expect(html).toContain('Tu contraseña seguirá siendo la misma');
    expect(text).toContain('Nunca compartas este enlace');
  });
  it('escapa los valores insertados en HTML y conserva el enlace original en texto plano', () => {
    const input = 'https://example.com/reset?token="\'><script>alert(1)</script>&next=1';
    const { html, text } = buildPasswordResetEmail(input);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&#39;&gt;&lt;script&gt;');
    expect(text).toContain(input);
  });
  it('usa el logo público de Jarvis como respaldo y permite el logo HTTPS configurado', () => {
    expect(buildPasswordResetEmail(url, 'javascript:alert(1)').html).toContain('src="https://www.jarviscol.com/logo5.png"');
    expect(buildPasswordResetEmail(url, 'https://example.com/logo.png').html).toContain('src="https://example.com/logo.png"');
    expect(buildPasswordResetEmail(url, '').html).toContain('src="https://www.jarviscol.com/logo5.png"');
  });
});
