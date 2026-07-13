export function normalizeSupportDocumentType(value?: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return 'NIT';
  }

  const normalized = trimmed
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (
    normalized === 'NIT' ||
    normalized === '31' ||
    normalized === 'RUT' ||
    normalized.includes('NIT')
  ) {
    return 'NIT';
  }

  if (
    normalized === 'CC' ||
    normalized === '13' ||
    normalized === 'CI' ||
    normalized === 'CEDULA' ||
    normalized === 'CEDULA DE CIUDADANIA' ||
    normalized.includes('CEDULA')
  ) {
    return 'CC';
  }

  if (normalized === 'CE' || normalized === '22' || normalized.includes('EXTRANJ')) {
    return 'CE';
  }

  if (normalized === 'PASAPORTE' || normalized === '41' || normalized === 'PA') {
    return 'PA';
  }

  return trimmed.toUpperCase();
}
