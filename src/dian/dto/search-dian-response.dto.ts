import {
  DianInvoiceResult,
  DianSearchError,
} from '../interfaces/dian-invoice-result.interface';

export class SearchDianResponseDto {
  totalProcesados: number;
  totalExitosos: number;
  totalFallidos: number;
  resultados: DianInvoiceResult[];
  errores: DianSearchError[];
}
