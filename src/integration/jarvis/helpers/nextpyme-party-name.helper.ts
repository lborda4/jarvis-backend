/** NextPyme/DIAN: persona jurídica va en un string; persona natural en
 * [nombres, primer apellido, segundo apellido]. El RUT suele llegar como
 * APELLIDOS + NOMBRES; DSAJ10a valida el primer elemento como nombre propio. */
export function toNextPymePartyName(
  fullName: string,
  organizationTypeId: number,
): string | string[] {
  const name = fullName.trim();
  if (organizationTypeId !== 2) {
    return name;
  }

  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return parts.length === 1 ? parts : [name];
  }

  if (parts.length === 2) {
    return [parts[1], parts[0]];
  }

  if (parts.length === 3) {
    return [parts[2], parts[0], parts[1]];
  }

  return [parts.slice(2).join(' '), parts[0], parts[1]];
}
