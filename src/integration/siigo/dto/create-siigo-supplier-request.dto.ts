export class CreateSiigoSupplierRequestDto {
  documentId: string;

  /** person | company. Si no viene (ej. creación automática en segundo
   * plano), se infiere del documentType del proveedor (NIT -> company,
   * cédula -> person). */
  person_type?: string;

  /** Datos del modal (autocomplete NextPyme / captura manual). */
  name?: string;
  document_type?: string;
  document_number?: string;
  check_digit?: string;
  email?: string;
  phone?: string;
  address?: string;
}
