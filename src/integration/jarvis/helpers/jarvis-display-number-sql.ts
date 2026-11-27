/** SQL expression for searches only; stored and transmitted document numbers remain unchanged. */
export function jarvisDisplayNumberSql(prefix: string, number: string): string {
  const suffix = `(CASE WHEN LEFT(${number}, LENGTH(${prefix})) = ${prefix} THEN SUBSTRING(${number} FROM LENGTH(${prefix}) + 1) ELSE ${number} END)`;
  return `(CASE WHEN ${prefix} = '' THEN ${number}
    WHEN ${number} = '' THEN ${prefix}
    WHEN ${suffix} = '' THEN ${number}
    WHEN RIGHT(${prefix}, 1) = '-' AND LEFT(${suffix}, 1) = '-' THEN ${prefix} || SUBSTRING(${suffix} FROM 2)
    WHEN RIGHT(${prefix}, 1) = '-' OR LEFT(${suffix}, 1) = '-' THEN ${prefix} || ${suffix}
    ELSE ${prefix} || '-' || ${suffix} END)`;
}
