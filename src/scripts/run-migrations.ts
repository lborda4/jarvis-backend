import 'dotenv/config';
import dataSource from '../config/data-source';

async function runMigrations(): Promise<void> {
  await dataSource.initialize();

  const executed = await dataSource.runMigrations();
  const names = executed.map((migration) => migration.name);

  if (names.length === 0) {
    console.log('No hay migraciones pendientes.');
  } else {
    console.log('Migraciones ejecutadas:', names.join(', '));
  }

  await dataSource.destroy();
}

runMigrations().catch((error) => {
  console.error('Error al ejecutar migraciones:', error);
  process.exit(1);
});
