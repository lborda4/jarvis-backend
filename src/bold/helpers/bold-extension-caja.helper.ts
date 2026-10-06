export function matchesExtensionCaja(
  register: { cashRegisterName: string; cashRegisterId?: string | null },
  caja: string,
): boolean {
  const key = caja.trim().toLowerCase();
  if (!key) return false;
  if (register.cashRegisterId?.trim().toLowerCase() === key) return true;
  const name = register.cashRegisterName.trim().toLowerCase();
  if (name === key) return true;
  const withoutPrefix = (value: string) => value.replace(/^caja\s+/, '');
  return withoutPrefix(name) === withoutPrefix(key);
}
