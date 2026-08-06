export class CreateSiigoSupplierRequestDto {
  documentId: string;

  /** person | company — obligatorio para SIIGO */
  person_type: string;
}
