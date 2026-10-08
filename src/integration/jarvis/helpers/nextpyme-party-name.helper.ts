/** NextPyme valida `customer.name` como string. Persona jurídica va tal cual;
 * persona natural reordena RUT (APELLIDOS + NOMBRES) a nombres primero, porque
 * DSAJ10a trata el primer token como nombre propio. */
export function toNextPymePartyName(
  fullName: string,
  organizationTypeId: number,
): string {
  const name = fullName.trim();
  if (organizationTypeId !== 2) {
    return name;
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return name;
  }

  if (parts.length === 2) {
    return `${parts[1]} ${parts[0]}`;
  }

  if (parts.length === 3) {
    return `${parts[2]} ${parts[0]} ${parts[1]}`;
  }

  return `${parts.slice(2).join(' ')} ${parts[0]} ${parts[1]}`;
}
