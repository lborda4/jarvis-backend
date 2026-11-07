const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function buildWelcomeEmail(companyName: string, url: string) {
  const company = escapeHtml(companyName), link = escapeHtml(url);
  return {
    subject: '¡Bienvenido a Jarvis! Crea tu cuenta',
    text: `¡Bienvenido a JARVIS!\n\n${companyName} ya está lista en Jarvis. Crea tu usuario desde este enlace:\n\n${url}\n\nEl enlace identifica tu empresa: no necesitas NIT ni código de invitación. Es válido durante 72 horas y solo puede usarse una vez.\n\nAcepta la política de tratamiento de datos y los términos del servicio para completar tu registro.\n\nSi ya tienes una cuenta con este correo, utiliza tu contraseña actual para vincular la empresa.\n\nSi no esperabas esta invitación, ignora este correo. No compartas el enlace.\n\n¿Necesitas ayuda? gerencia@jarviscol.com\nhttps://www.jarviscol.com`,
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bienvenido a Jarvis</title></head>
<body style="margin:0;background:#edf3f6;font-family:Arial,Helvetica,sans-serif;color:#102c42;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Tu empresa ya está lista. Crea tu cuenta y comienza a usar Jarvis.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf3f6;"><tr><td align="center" style="padding:32px 16px;">
<!--[if mso]><table role="presentation" width="580"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border:1px solid #dce7ed;border-radius:18px;">
<tr><td style="padding:28px;background:#0b2535;border-radius:18px 18px 0 0;border-bottom:3px solid #00c5cc;"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td><img src="https://www.jarviscol.com/logo5.png" width="56" height="56" alt="Jarvis" style="display:block;border:0;"></td><td style="padding-left:12px;"><strong style="color:#ffffff;font-size:25px;letter-spacing:4px;">JAR<span style="color:#00c5cc;">V</span>IS</strong><p style="margin:6px 0 0;color:#b8d0da;font-size:10px;letter-spacing:1px;">AUTOMATIZA · CONECTA · SIMPLIFICA</p></td></tr></table></td></tr>
<tr><td style="padding:32px 28px;"><p style="margin:0 0 12px;color:#087f80;font-size:11px;font-weight:bold;letter-spacing:1.5px;">TU EMPRESA, CONECTADA</p>
<h1 style="margin:0 0 18px;font-size:29px;line-height:1.2;">¡Bienvenido a Jarvis!</h1>
<p style="color:#536575;font-size:15px;line-height:1.75;margin:0 0 24px;">Ya preparamos el espacio de <strong style="color:#102c42;">${company}</strong>. Solo falta crear tu usuario para comenzar.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eefaf8;border:1px solid #cdebe5;border-radius:10px;"><tr><td style="padding:18px;font-size:14px;line-height:1.7;color:#0b6c69;"><strong>Tu empresa ya viene incluida en el enlace.</strong><br>No necesitas ingresar NIT ni código de invitación.</td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#098d88" style="background:#098d88;border-radius:9px;mso-padding-alt:16px 24px;"><a href="${link}" style="display:block;padding:16px 24px;border:1px solid #098d88;border-radius:9px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;">Crear mi cuenta &rarr;</a></td></tr></table>
<p style="font-size:13px;line-height:1.7;color:#536575;"><strong>El enlace vence en 72 horas</strong> y solo puede usarse una vez. Para completar el registro, acepta la política de tratamiento de datos y los términos del servicio.</p>
<p style="font-size:12px;line-height:1.7;color:#627280;">Si ya tienes una cuenta con este correo, utiliza tu contraseña actual para vincular esta empresa.</p>
<p style="font-size:12px;line-height:1.7;color:#627280;margin-bottom:6px;">Si el botón no abre, copia este enlace en tu navegador:</p>
<p style="font-size:12px;line-height:1.7;word-break:break-all;overflow-wrap:anywhere;"><a href="${link}" style="color:#087f80;word-break:break-all;">${link}</a></p>
<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e3ebef;font-size:12px;line-height:1.7;color:#627280;">Si no esperabas esta invitación, puedes ignorarla. No compartas este enlace: permite crear un usuario para tu empresa.</p></td></tr>
<tr><td align="center" style="padding:22px;background:#f7fafb;border-top:1px solid #e3ebef;border-radius:0 0 18px 18px;font-size:12px;line-height:1.7;color:#526575;">¿Necesitas ayuda? <a href="mailto:gerencia@jarviscol.com" style="color:#087f80;">Escríbenos</a><br><a href="https://www.jarviscol.com" style="color:#102c42;text-decoration:none;font-weight:bold;">www.jarviscol.com</a></td></tr>
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`,
  };
}
