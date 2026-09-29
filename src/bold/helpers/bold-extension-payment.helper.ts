import { BadRequestException } from '@nestjs/common';

export function parseBoldExtensionPayment(body: unknown): { caja: string; total: number } {
  if (!body || typeof body !== 'object') throw new BadRequestException('Debe enviar caja y valor.');
  const { caja, valor } = body as Record<string, unknown>;
  if ((typeof caja !== 'string' && typeof caja !== 'number') ||
      (typeof caja === 'number' && !Number.isFinite(caja)) || !String(caja).trim()) {
    throw new BadRequestException('La caja es obligatoria.');
  }
  let total: number;
  if (typeof valor === 'number') {
    total = valor;
  } else if (typeof valor === 'string') {
    const formatted = valor.trim().replace(/^\$\s*/, '');
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(formatted)) {
      throw new BadRequestException('El valor debe tener formato colombiano, por ejemplo $15.000,00.');
    }
    total = Number(formatted.replace(/\./g, '').replace(',', '.'));
  } else {
    throw new BadRequestException('El valor del cobro es obligatorio.');
  }
  if (!Number.isFinite(total) || total <= 0 || total > Number.MAX_SAFE_INTEGER / 100) {
    throw new BadRequestException('El valor del cobro debe ser mayor a cero y válido.');
  }
  return { caja: String(caja).trim(), total };
}
