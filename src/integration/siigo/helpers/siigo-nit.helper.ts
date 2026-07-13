export function splitNitAndCheckDigit(documentNumber: string): {
  identification: string;
  checkDigit: string;
} {
  const trimmed = documentNumber.trim();

  if (trimmed.includes('-')) {
    const [base, digit] = trimmed.split('-', 2);

    return {
      identification: base.replace(/[^\d]/g, ''),
      checkDigit: digit?.replace(/[^\d]/g, '') || '0',
    };
  }

  const digits = trimmed.replace(/[^\d]/g, '');

  if (digits.length > 9) {
    return {
      identification: digits.slice(0, -1),
      checkDigit: digits.slice(-1),
    };
  }

  return {
    identification: digits,
    checkDigit: '0',
  };
}
