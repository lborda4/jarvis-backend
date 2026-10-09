import { Font } from '@react-pdf/renderer';

let registered = false;

export function keepPdfWordIntact(word: string): string[] {
  return [word];
}

export function disablePdfHyphenation() {
  if (registered) return;
  Font.registerHyphenationCallback(keepPdfWordIntact);
  registered = true;
}
