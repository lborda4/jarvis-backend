const small = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const tens = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const hundreds = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
function integer(n: number): string {
  if (n < 30) return small[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ` y ${integer(n % 10)}` : '');
  if (n === 100) return 'cien';
  if (n < 1000) return hundreds[Math.floor(n / 100)] + (n % 100 ? ` ${integer(n % 100)}` : '');
  if (n < 1_000_000) return (n < 2000 ? 'mil' : `${apocopate(integer(Math.floor(n / 1000)))} mil`) + (n % 1000 ? ` ${integer(n % 1000)}` : '');
  if (n < 1_000_000_000_000) return (n < 2_000_000 ? 'un millón' : `${apocopate(integer(Math.floor(n / 1_000_000)))} millones`) + (n % 1_000_000 ? ` ${integer(n % 1_000_000)}` : '');
  return (n < 2_000_000_000_000 ? 'un billón' : `${apocopate(integer(Math.floor(n / 1_000_000_000_000)))} billones`) + (n % 1_000_000_000_000 ? ` ${integer(n % 1_000_000_000_000)}` : '');
}
function apocopate(value: string) { return value.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un'); }
export function amountInSpanish(amount: number, currency: string): string {
  const cents = Math.round(Math.abs(amount) * 100);
  if (!Number.isSafeInteger(cents)) return `${amount.toLocaleString('es-CO')} ${currency}`;
  const whole = Math.floor(cents / 100);
  const unit = currency === 'COP' ? (whole === 1 ? 'peso colombiano' : 'pesos colombianos') : currency;
  return `${amount < 0 ? 'menos ' : ''}${apocopate(integer(whole))}${whole > 0 && whole % 1_000_000 === 0 ? ' de' : ''} ${unit} con ${String(cents % 100).padStart(2, '0')}/100`;
}
