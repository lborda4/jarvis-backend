export function jarvisTaxTechnicalDetails(type: string, rate: number) {
  const normalized = type.toLowerCase().replace(/[^a-z]/g, '');
  const divisor = normalized === 'reteica' ? 1000 : 100;
  return { divisor, factor: rate / divisor, usesIvaBase: normalized === 'reteiva' };
}

export function calculateJarvisRetention(type: string, rate: number, subtotal: number, iva: number) {
  const { divisor, factor, usesIvaBase } = jarvisTaxTechnicalDetails(type, rate);
  const base = usesIvaBase ? iva : subtotal;
  return { base, amount: Math.round((base * factor + Number.EPSILON) * 100) / 100, percent: Number((rate * 100 / divisor).toFixed(6)) };
}
