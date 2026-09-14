import {
  resolveSiigoCostCenter,
  resolveSiigoCostCenterId,
} from './siigo-cost-center-match.helper';
import { SiigoCostCenterCatalogItemDto } from '../dto/list-siigo-cost-centers.dto';

const CATALOG: SiigoCostCenterCatalogItemDto[] = [
  { id: 1, code: '001', name: 'Administración' },
  { id: 2, code: '002', name: 'Ventas' },
];

describe('resolveSiigoCostCenter', () => {
  it('matchea por el formato "código - nombre" completo que arma la lista desplegable de la plantilla', () => {
    expect(resolveSiigoCostCenter('001 - Administración', CATALOG)).toEqual(
      CATALOG[0],
    );
  });

  it('el match por "código - nombre" es insensible a mayúsculas/acentos', () => {
    expect(resolveSiigoCostCenter('002 - ventas', CATALOG)).toEqual(CATALOG[1]);
  });

  it('matchea por código solo (usuario escribió el código a mano)', () => {
    expect(resolveSiigoCostCenter('001', CATALOG)).toEqual(CATALOG[0]);
  });

  it('matchea por nombre solo (usuario escribió el nombre a mano)', () => {
    expect(resolveSiigoCostCenter('Ventas', CATALOG)).toEqual(CATALOG[1]);
  });

  it('devuelve null si no matchea nada (typo, o un valor que ya no existe en el catálogo)', () => {
    expect(resolveSiigoCostCenter('Marketing', CATALOG)).toBeNull();
    expect(resolveSiigoCostCenter('001 - Marketing', CATALOG)).toBeNull();
  });

  it('devuelve null para texto vacío o undefined, sin reventar', () => {
    expect(resolveSiigoCostCenter('', CATALOG)).toBeNull();
    expect(resolveSiigoCostCenter(undefined, CATALOG)).toBeNull();
    expect(resolveSiigoCostCenter('   ', CATALOG)).toBeNull();
  });

  it('devuelve null si el catálogo está vacío', () => {
    expect(resolveSiigoCostCenter('001', [])).toBeNull();
  });
});

describe('resolveSiigoCostCenterId', () => {
  it('devuelve solo el id del match', () => {
    expect(resolveSiigoCostCenterId('001 - Administración', CATALOG)).toBe(1);
    expect(resolveSiigoCostCenterId('Marketing', CATALOG)).toBeNull();
  });
});
