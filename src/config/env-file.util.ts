import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

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
