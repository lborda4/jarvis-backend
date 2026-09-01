import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

// dotenv imprime un banner de "tip" en cada carga (a veces con URLs
// externas que no controlamos) — no aporta nada acá y solo genera ruido y
// confusión en los logs. DOTENV_CONFIG_QUIET es una variable de entorno
// global que dotenv respeta en TODAS sus invocaciones del proceso, incluida
// la interna de @nestjs/config (ConfigModule.forRoot, que también trae su
// propia copia de dotenv) — no solo la llamada explícita de este archivo —
// así que alcanza con setearla una vez, antes de que cualquiera llame a
// dotenv. Se respeta si ya viene seteada desde afuera (no se pisa).
if (process.env.DOTENV_CONFIG_QUIET === undefined) {
  process.env.DOTENV_CONFIG_QUIET = 'true';
}

const ENV_FILE_BY_NODE_ENV: Record<string, string> = {
  local: '.env.local',
  development: '.env.local',
  qa: '.env.qa',
  production: '.env.production',
  prod: '.env.production',
};

export function resolveEnvFilePath(nodeEnv = process.env.NODE_ENV?.trim()): string {
  const normalizedNodeEnv = nodeEnv || 'local';

  return ENV_FILE_BY_NODE_ENV[normalizedNodeEnv] ?? '.env.local';
}

export function buildEnvFilePaths(nodeEnv = process.env.NODE_ENV?.trim()): string[] {
  const candidates = [resolveEnvFilePath(nodeEnv), '.env'];

  return candidates.filter((candidate, index) => {
    if (!existsSync(resolve(process.cwd(), candidate))) {
      return false;
    }

    return candidates.indexOf(candidate) === index;
  });
}

export function loadEnvironmentVariables(): string[] {
  const loadedFiles = [...buildEnvFilePaths()].reverse();

  for (const candidate of loadedFiles) {
    loadDotenv({
      path: resolve(process.cwd(), candidate),
      override: true,
    });
  }

  return buildEnvFilePaths();
}
