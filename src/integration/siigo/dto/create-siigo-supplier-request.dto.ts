export class CreateSiigoSupplierRequestDto {
  documentId: string;

  /** person | company — obligatorio para SIIGO */
  person_type: string;

  /** Datos del modal (autocomplete NextPyme / captura manual). */
  name?: string;
  document_type?: string;
  document_number?: string;
  check_digit?: string;
  email?: string;
  phone?: string;
  address?: string;
}
