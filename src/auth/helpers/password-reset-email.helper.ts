const WEBSITE = 'https://www.jarviscol.com';
const DEFAULT_LOGO = `${WEBSITE}/logo5.png`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildPasswordResetEmail(resetUrl: string, logoUrl = process.env.JARVIS_EMAIL_LOGO_URL): { subject: string; html: string; text: string } {
  const link = escapeHtml(resetUrl);
  const logo = escapeHtml(logoUrl && /^https:\/\/[^\s]+$/i.test(logoUrl.trim()) ? logoUrl.trim() : DEFAULT_LOGO);
  return {
    subject: 'Restablece tu contraseña en Jarvis',
    text: `JARVIS · Automatiza. Conecta. Simplifica.

Vuelve a tu cuenta

Recibimos una solicitud para restablecer la contraseña de tu cuenta en Jarvis.

Crea tu nueva contraseña aquí:
${resetUrl}

El enlace vence en 45 minutos y solo puede usarse una vez.

Si no solicitaste este cambio, ignora este correo. Tu contraseña seguirá siendo la misma.
Nunca compartas este enlace ni tu contraseña.

¿Necesitas ayuda? Escríbenos a gerencia@jarviscol.com.
${WEBSITE}

Este es un correo automático de seguridad de tu cuenta.`,
    html: `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Restablece tu contraseña en Jarvis</title>
  <style>
    @media only screen and (max-width: 600px) {
      .jv-reset-shell { padding: 20px 12px !important; }
      .jv-reset-header { padding: 24px !important; }
      .jv-reset-content { padding: 28px 24px !important; }
      .jv-reset-title { font-size: 26px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#edf3f6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#edf3f6;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Recupera el acceso a tu cuenta Jarvis. Tu enlace está disponible durante 45 minutos.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#edf3f6;">
    <tr><td class="jv-reset-shell" align="center" style="padding:40px 16px;">
      <!--[if mso]><table role="presentation" width="580" align="center"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:580px;background-color:#ffffff;border:1px solid #dce7ed;border-radius:18px;border-spacing:0;">
        <tr><td class="jv-reset-header" bgcolor="#0b2535" style="padding:28px 36px;background-color:#0b2535;border-radius:18px 18px 0 0;border-bottom:3px solid #00c5cc;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="64" valign="middle" style="width:64px;"><img src="${logo}" alt="JARVIS" width="56" height="56" style="display:block;width:56px;height:56px;border:0;"></td>
            <td valign="middle" style="padding-left:12px;"><p style="margin:0;color:#ffffff;font-size:25px;font-weight:bold;letter-spacing:5px;">JAR<span style="color:#00c5cc;">V</span>IS</p><p style="margin:7px 0 0;color:#b8d0da;font-size:10px;letter-spacing:1.3px;line-height:1.6;">AUTOMATIZA · CONECTA · SIMPLIFICA</p></td>
          </tr></table>
        </td></tr>
        <tr><td class="jv-reset-content" style="padding:36px;color:#102c42;">
          <p style="margin:0 0 12px;color:#087f80;font-size:11px;font-weight:bold;letter-spacing:1.5px;line-height:1.5;">SEGURIDAD DE TU CUENTA</p>
          <h1 class="jv-reset-title" style="margin:0 0 18px;color:#102c42;font-size:30px;font-weight:bold;line-height:1.2;letter-spacing:-0.7px;">Vuelve a tu cuenta</h1>
          <p style="margin:0 0 24px;color:#536575;font-size:15px;line-height:1.75;">Recibimos una solicitud para restablecer la contraseña de tu cuenta en <strong style="color:#102c42;">Jarvis</strong>. Haz clic en el botón para elegir una nueva y recuperar tu acceso.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:24px;background-color:#eefaf8;border:1px solid #cdebe5;border-radius:10px;">
            <tr><td style="padding:16px 18px;"><p style="margin:0;color:#0b6c69;font-size:14px;line-height:1.6;"><strong>Tu enlace vence en 45 minutos</strong></p><p style="margin:3px 0 0;color:#526b70;font-size:13px;line-height:1.6;">Por tu seguridad, solo puede usarse una vez.</p></td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:26px;"><tr>
            <td align="center" bgcolor="#098d88" style="background-color:#098d88;border-radius:9px;mso-padding-alt:16px 24px;">
              <a href="${link}" target="_blank" style="display:block;padding:16px 24px;border:1px solid #098d88;border-radius:9px;color:#ffffff;font-size:15px;font-weight:bold;text-align:center;text-decoration:none;line-height:1.5;">Crear nueva contraseña &rarr;</a>
            </td>
          </tr></table>
          <p style="margin:0 0 8px;color:#526575;font-size:12px;line-height:1.6;">Si el botón no abre el enlace, cópialo y pégalo en tu navegador:</p>
          <p style="margin:0 0 26px;word-break:break-all;overflow-wrap:anywhere;font-size:12px;line-height:1.65;"><a href="${link}" style="color:#087f80;text-decoration:underline;word-break:break-all;">${link}</a></p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #e3ebef;"><tr><td style="padding-top:22px;">
            <p style="margin:0 0 6px;color:#102c42;font-size:13px;font-weight:bold;line-height:1.6;">¿No solicitaste este cambio?</p>
            <p style="margin:0;color:#627280;font-size:13px;line-height:1.7;">Puedes ignorar este correo. Tu contraseña seguirá siendo la misma. Nunca compartas este enlace ni tu contraseña.</p>
          </td></tr></table>
        </td></tr>
        <tr><td align="center" style="padding:22px 24px;background-color:#f7fafb;border-top:1px solid #e3ebef;border-radius:0 0 18px 18px;">
          <p style="margin:0 0 6px;color:#526575;font-size:12px;line-height:1.7;">¿Necesitas ayuda? <a href="mailto:gerencia@jarviscol.com" style="color:#087f80;text-decoration:none;font-weight:bold;">Escríbenos</a></p>
          <a href="${WEBSITE}" style="color:#102c42;text-decoration:none;font-size:12px;font-weight:bold;letter-spacing:0.5px;">www.jarviscol.com</a>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="max-width:500px;margin:20px auto 0;color:#72828e;font-size:11px;text-align:center;line-height:1.7;">Este es un correo automático de seguridad de tu cuenta.<br>JARVIS · Automatiza. Conecta. Simplifica.</p>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
