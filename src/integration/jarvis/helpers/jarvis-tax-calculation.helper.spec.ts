import { calculateJarvisRetention } from './jarvis-tax-calculation.helper';
import { JARVIS_DEFAULT_TAXES } from '../constants/jarvis-default-taxes';

describe('Catálogo solicitado y cálculos técnicos', () => {
  it('contiene los 28 códigos sin duplicados y conserva las tres variantes de IVA cero', () => {
    expect(JARVIS_DEFAULT_TAXES).toHaveLength(24);
    expect(new Set(JARVIS_DEFAULT_TAXES.map(tax => tax.code)).size).toBe(24);
    expect(JARVIS_DEFAULT_TAXES.filter(tax => tax.taxType === 'IVA').map(tax => Number(tax.rate))).toEqual([0, 5, 19]);
  });
  it('ReteICA 4,14 por mil = 414 sobre 100.000', () => {
    expect(calculateJarvisRetention('ReteICA', 4.14, 100000, 19000)).toEqual({ base: 100000, amount: 414, percent: 0.414 });
  });
  it('ReteIVA 15% usa el IVA y no el subtotal', () => {
    expect(calculateJarvisRetention('ReteIVA', 15, 100000, 19000)).toEqual({ base: 19000, amount: 2850, percent: 15 });
  });
  it('Retefuente usa la base del ítem', () => {
    expect(calculateJarvisRetention('Retefuente', 2.5, 100000, 19000).amount).toBe(2500);
  });
});
