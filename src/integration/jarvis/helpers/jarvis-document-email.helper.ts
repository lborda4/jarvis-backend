import { buildDianCatalogQrUrl } from '../../../electronic-document/helpers/dian-invoice-qr.helper';

const templates = {
  html_header:
    "<table role='presentation' align='center' width='100%' cellpadding='0' cellspacing='0' border='0' style='max-width:860px;margin:0 auto;border-collapse:collapse;font-family:Arial,sans-serif;color:#071C3A;background:#F0F9FD;'><tr><td style='padding:16px 16px 0;'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:14px 14px 0 0;'><tr><td width='60%' style='padding:22px 24px;border-bottom:1px solid #DFE6ED;'><table role='presentation' cellpadding='0' cellspacing='0'><tr><td><img src='{{logo_jarvis_url}}' alt='JARVIS' width='48' style='display:block;width:48px;height:auto;border:0;'></td><td style='padding-left:12px;'><strong style='font-size:26px;letter-spacing:6px;'>JAR<span style='color:#089F9B;'>V</span>IS</strong><br><span style='font-size:8px;letter-spacing:1px;'>AUTOMATIZA. CONECTA. SIMPLIFICA.</span></td></tr></table></td><td width='40%' style='padding:18px 24px;border-bottom:1px solid #DFE6ED;background:#F5FCFE;border-radius:0 14px 0 0;'><p style='margin:0;border-left:1px solid #CBD5E1;padding-left:18px;font-size:11px;line-height:1.5;color:#64748B;'>Documento electrónico generado mediante <strong style='color:#071C3A;'>JARVIS</strong> para su procesamiento y transmisión.</p></td></tr></table></td></tr></table>",
  html_body:
    "<table role='presentation' align='center' width='100%' cellpadding='0' cellspacing='0' border='0' style='max-width:860px;margin:0 auto;border-collapse:collapse;font-family:Arial,sans-serif;color:#071C3A;background:#F0F9FD;'><tr><td style='padding:0 16px;'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#ffffff;table-layout:fixed;'><tr><td width='62%' valign='top' style='padding:20px 16px 16px 24px;word-wrap:break-word;'><h2 style='margin:0 0 12px;font-size:24px;'>¡Hola, {{nombre_receptor}}!</h2><p style='margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569;'><strong style='color:#071C3A;'>{{razon_social_emisor}}</strong> te informa que se generó el siguiente documento electrónico a tu nombre.</p><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F7FBFD;border:1px solid #DFE6ED;border-radius:8px;table-layout:fixed;'><tr><td width='43%' valign='middle' style='padding:16px 12px;word-wrap:break-word;'><span style='font-size:28px;color:#089F9B;'>&#9636;</span><p style='margin:8px 0;font-size:13px;'>{{tipo_documento}}</p><strong style='font-size:24px;'>{{numero_documento}}</strong></td><td width='57%' style='padding:12px;border-left:1px solid #CBD5E1;word-wrap:break-word;'><span style='font-size:11px;color:#64748B;'>Fecha de emisión</span><p style='margin:4px 0 10px;font-size:12px;font-weight:bold;'>{{fecha_emision}}</p><div style='border-top:1px solid #DFE6ED;padding-top:8px;'><span style='font-size:11px;color:#64748B;'>A nombre de</span><p style='margin:4px 0 10px;font-size:12px;'>{{razon_social_receptor}}</p></div><div style='border-top:1px solid #DFE6ED;padding-top:8px;'><span style='font-size:11px;color:#64748B;'>Total del documento</span><p style='margin:4px 0;font-size:16px;font-weight:bold;'>{{valor_total}} {{moneda}}</p></div></td></tr></table></td><td width='38%' valign='top' style='padding:20px 24px 16px 0;word-wrap:break-word;'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F4F7FC;border-radius:8px;'><tr><td style='padding:16px;'><strong style='font-size:16px;'>Documentos adjuntos</strong><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin-top:12px;background:#ffffff;border:1px solid #DFE6ED;border-radius:8px;'><tr><td width='44' style='padding:12px 8px;'><span style='display:block;background:#EF3340;color:#ffffff;border-radius:5px;padding:12px 4px;font-size:11px;text-align:center;font-weight:bold;'>PDF</span></td><td style='padding:12px 8px;font-size:12px;'><strong>{{numero_documento}}.pdf</strong><p style='margin:5px 0 0;color:#64748B;font-size:11px;'>Representación gráfica del documento</p></td></tr></table><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='margin-top:10px;background:#ffffff;border:1px solid #DFE6ED;border-radius:8px;'><tr><td width='44' style='padding:12px 8px;'><span style='display:block;background:#D9ECFF;color:#1453A0;border-radius:5px;padding:12px 4px;font-size:13px;text-align:center;font-weight:bold;'>&lt;/&gt;</span></td><td style='padding:12px 8px;font-size:12px;'><strong>{{numero_documento}}.xml</strong><p style='margin:5px 0 0;color:#64748B;font-size:11px;'>Archivo XML - DIAN</p></td></tr></table>{{boton_comprobante}}<p style='margin:10px 0 0;font-size:10px;color:#64748B;'>PDF y XML incluidos en el ZIP adjunto.</p></td></tr></table></td></tr></table></td></tr></table>",
  html_footer:
    "<table role='presentation' align='center' width='100%' cellpadding='0' cellspacing='0' border='0' style='max-width:860px;margin:0 auto;border-collapse:collapse;font-family:Arial,sans-serif;color:#071C3A;background:#F0F9FD;'><tr><td style='padding:0 16px 16px;'><table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:0 0 14px 14px;table-layout:fixed;'><tr><td width='30%' valign='top' style='padding:16px 24px;border-top:1px solid #DFE6ED;font-size:11px;line-height:1.5;color:#64748B;'><span style='color:#071C3A;font-size:20px;'>&#9993;</span><br>Incluimos para tu consulta la representación gráfica en PDF y el archivo XML.</td><td width='33%' valign='top' style='padding:16px;border-top:1px solid #DFE6ED;font-size:11px;line-height:1.5;color:#64748B;'><span style='color:#071C3A;font-size:20px;'>&#9743;</span><br>Para consultas relacionadas con este documento, comunícate directamente con <strong style='color:#071C3A;'>{{razon_social_emisor}}</strong>.</td><td width='37%' valign='top' style='padding:16px 24px 16px 16px;border-top:1px solid #DFE6ED;font-size:11px;line-height:1.5;color:#64748B;'><span style='color:#071C3A;font-size:20px;'>&#9672;</span><br>Si sospechas fraude, consulta con la empresa emisora antes de pagar. Correo automático; no respondas a esta dirección.<br><a href='https://jarviscol.com' style='color:#089F9B;text-decoration:none;'>www.jarviscol.com</a></td></tr></table></td></tr></table>",
};

export interface JarvisDocumentEmailData {
  issuerName: string;
  issuerNit: string;
  receiverName: string;
  documentNumber: string;
  issueDate: string;
  total: number;
  currency: string;
  documentKind?: string | null;
  cufe?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildJarvisDocumentEmail(data: JarvisDocumentEmailData) {
  const labels: Record<string, string> = {
    ELECTRONIC_INVOICE: 'Factura electrónica',
    CREDIT_NOTE: 'Nota crédito',
    DEBIT_NOTE: 'Nota débito',
    SUPPORT_DOCUMENT: 'Documento soporte',
    SUPPORT_CREDIT_NOTE: 'Nota de ajuste de documento soporte',
  };
  // El sidebar del frontend utiliza el archivo público /logo5.png.
  const logo =
    process.env.JARVIS_EMAIL_LOGO_URL?.trim() ||
    'https://www.jarviscol.com/logo5.png';
  const validLogo = /^https:\/\//i.test(logo);
  const values: Record<string, string> = {
    razon_social_emisor: data.issuerName,
    nit_emisor: data.issuerNit,
    nombre_receptor: data.receiverName,
    razon_social_receptor: data.receiverName,
    numero_documento: data.documentNumber,
    fecha_emision:
      /^\d{4}-\d{2}-\d{2}$/.test(data.issueDate) &&
      !Number.isNaN(Date.parse(data.issueDate))
        ? new Intl.DateTimeFormat('es-CO', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(data.issueDate))
        : data.issueDate,
    valor_total: new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(data.total),
    moneda: data.currency,
    tipo_documento: labels[data.documentKind || ''] || 'Documento electrónico',
    logo_jarvis_url: validLogo ? logo : '',
  };
  const button = data.cufe
    ? `<a href="${escapeHtml(buildDianCatalogQrUrl(data.cufe))}" target="_blank" style="display:block;margin-top:12px;background:#087EF5;color:#ffffff;text-decoration:none;text-align:center;padding:12px 8px;border-radius:6px;font-size:13px;font-weight:bold;">Ver comprobante &rarr;</a>`
    : '';
  const render = (template: string) => {
    template = template.replace('{{boton_comprobante}}', button);
    const withLogo = validLogo
      ? template
      : template.replace(
          /<img[^>]*>/g,
          '<strong style="color:#071C3A;font-size:14px;">JARVIS</strong>',
        );
    return withLogo.replace(/{{(\w+)}}/g, (_, key: string) =>
      escapeHtml(values[key] || ''),
    );
  };
  return {
    html_header: render(templates.html_header),
    html_body: render(templates.html_body),
    html_buttons: '',
    html_footer: render(templates.html_footer),
  };
}
