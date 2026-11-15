# Revisión de base de datos — 14 de noviembre de 2026

## Conclusión

La cantidad de tablas es razonable para las funciones actuales. No encontré una tabla completa que se pueda considerar abandonada con la evidencia disponible. Las oportunidades principales están en proteger la estructura contra cambios automáticos, evitar registros duplicados y definir cuánto historial operativo conservar.

No recomiendo borrar tablas ni fusionar módulos para reducir el número visual de tablas. Sí recomiendo corregir los hallazgos de integridad y controlar el crecimiento de registros antes de agregar más funciones.

## Alcance y método

- Base apuntada por `.env.local`, usando la conexión existente de PostgreSQL/Neon. No se revisaron las bases de QA ni producción.
- Se inspeccionaron catálogos de PostgreSQL, restricciones, índices, tamaños, conteos, triggers y funciones; se contrastaron con entidades, migraciones y consultas del backend actual.
- Todas las consultas se ejecutaron en una transacción de solo lectura, con límites de tiempo y sin ejecutar funciones de aplicación que escriban datos.
- Se hicieron 74 comprobaciones agregadas de referencias, duplicados y pertenencia a empresa. No se extrajeron contenidos de documentos, información personal ni credenciales al informe.
- No se cambiaron tablas, datos, variables de entorno ni código de aplicación.
- Una referencia en el código acredita un consumidor previsto; no prueba que esa función tenga tráfico hoy. Una tabla vacía o un contador de accesos en cero tampoco demuestra desuso.

Las consultas principales se conservan en [database-review-2026-11-14.sql](database-review-2026-11-14.sql). El archivo permite repetir las verificaciones principales; los resultados cambiarán cuando cambien los datos.

## Tamaño y estructura observados

| Medida | Resultado |
| --- | ---: |
| Tablas de usuario, todas en `public` | 43 |
| Claves foráneas | 53 |
| Índices | 97 |
| Base completa | 29,48 MiB |
| Tablas e índices de usuario, incluyendo almacenamiento auxiliar | 20,29 MiB |
| Índices de usuario | 7,24 MiB |
| Grupos de índices estructuralmente idénticos detectados | 0 |
| Filas huérfanas en las 53 claves foráneas existentes | 0 |
| Referencias cruzadas entre empresas en las comprobaciones realizadas | 0 |

Las comprobaciones sobre tablas vacías, por ejemplo documentos de nómina en esta base, no prueban el comportamiento con datos futuros. No se midieron latencias ni planes de ejecución de carga real.

## Hallazgos, ordenados por prioridad

### 1. La base difiere de las migraciones y está habilitada la sincronización automática

En `.env.local` están activos tanto `DB_SYNCHRONIZE=true` como `DB_MIGRATIONS_RUN=true`. El backend transmite ambas opciones a TypeORM en `src/config/typeorm.config.ts:63`.

Se observaron ausencias concretas:

| Tabla | Definido en migraciones | Estado observado |
| --- | --- | --- |
| `user_companies` | `UNIQUE(user_id, company_id)` e índice por usuario | Solo índice de clave primaria; faltan esas protecciones |
| `jarvis_payment_methods` | Índice único por empresa y `lower(name)` | No existe ese índice único |
| `electronic_documents` | Índices por empresa, CUFE y empresa/proveedor, entre otros | No existen esos índices; permanecen la clave primaria y cuatro índices de búsqueda/expresión |
| `supplier_configurations` | Índices por empresa/integración y documento del proveedor | Solo índice de clave primaria |

Evidencia: `1741200000000-CreateUsersAndUserCompanies.ts:31`, `1791000000000-CreateJarvisPaymentMethods.ts:15`, `1740300000000-CreateElectronicDocuments.ts`, `1743700000000-AddElectronicDocumentsSearchIndexes.ts`, `1794000000000-IsolateDocumentIntegrationProvider.ts:15` y `1740000000000-CreateCompanyAndSupplierConfiguration.ts:43`.

Las entidades de `UserCompany`, `ElectronicDocument` y `SupplierConfiguration` no declaran todas estas estructuras. La combinación de sincronización automática y migraciones es una explicación compatible con la pérdida observada; no se dispone de un registro histórico de DDL para afirmar quién las eliminó.

Impacto: se pueden repetir asignaciones de usuarios o medios de pago y las consultas por empresa pueden degradarse al crecer. En particular, `JarvisPaymentMethodsService.list()` usa `orIgnore()` suponiendo que el índice único evita inserciones concurrentes; sin esa restricción no se cumple esa garantía.

Acción propuesta: detener la sincronización automática para bases persistentes y usar migraciones como autoridad. Restaurar selectivamente índices y restricciones mediante una migración nueva, después de revisar duplicados y el estado efectivo. No basta con volver a ejecutar el arranque: las migraciones ya figuran como aplicadas.

TypeORM recomienda desactivar la sincronización automática al trabajar con migraciones: [configuración de migraciones](https://typeorm.io/docs/migrations/setup/).

### 2. Ya hay configuraciones de proveedor duplicadas

Se encontraron **15 grupos** con más de una fila para la combinación exacta `(company_id, integration_id, supplier_document_type, supplier_document)` en `supplier_configurations`. No se trata de 15 tablas ni de un conteo de filas a borrar.

El repositorio busca la primera configuración cuyo documento normalizado coincide, sin un orden explícito (`src/integration/repositories/supplier-configurations.repository.ts:38`). Dos preferencias diferentes pueden competir por el mismo proveedor. Además, la búsqueda actual considera el documento normalizado, por lo que una futura restricción debe respetar esa misma identidad y no limitarse a agregar una unicidad textual que no cubra puntos, guiones u otras normalizaciones.

Acción propuesta: resolver cuál configuración conservar o cómo combinar sus preferencias; posteriormente imponer unicidad sobre la identidad de negocio acordada. No borrar automáticamente filas repetidas: podrían tener preferencias distintas.

No se encontraron duplicados en los otros grupos comprobados: usuario/empresa, nombre normalizado de medios de pago de facturación, empresa/proveedor de integración y empresa/proveedor/CUFE no nulo. Esto no sustituye una restricción para prevenirlos en el futuro.

### 3. Hay referencias a documentos eliminados en campos sin clave foránea

| Campo | Registros cuyo documento ya no existe |
| --- | ---: |
| `purchase_invoice_import_job_rows.document_id` | 442 |
| `ai_generation_logs.document_id` | 621 |

Estos campos no tienen FK. Las 53 claves foráneas que sí existen no mostraron huérfanos.

El backend permite eliminar documentos electrónicos (`src/electronic-document/electronic-document.service.ts:630` y `:674`). La persistencia de esos identificadores puede ser histórica e intencional; no demuestra por sí sola una pérdida o mezcla de datos. Falta hacer explícita la política: si el vínculo debe ser navegable, un identificador histórico o un valor nullable que se limpia al borrar el documento.

Acción propuesta: definir por separado el historial de auditoría de IA y el resultado de importaciones. Cuando corresponda, usar una FK con `ON DELETE SET NULL`, conservar una referencia histórica explícita o implementar una limpieza consistente. Agregar una FK directamente sobre los datos actuales fallaría sin resolver primero estas referencias.

### 4. El crecimiento futuro depende principalmente de historial y resultados operativos

`historial_facturas` tiene 10.526 filas y ocupa 10,57 MiB con sus índices: aproximadamente el 52% del almacenamiento de tablas de usuario. Son líneas de historial para sugerencias contables; no son necesariamente 10.526 facturas independientes.

También se acumulan:

- 1.303 filas de importación y 34 trabajos de importación.
- 900 registros de generación de IA.
- Historial de sincronización SIIGO, auditoría de nómina y transmisiones al proveedor.

No se encontró una política general de archivado/retención para esos datos en los módulos examinados. Sí existe una limpieza puntual de intentos de restablecimiento de contraseña de más de 24 horas; por eso no se afirma que no haya ninguna limpieza en el sistema.

Hay duplicación parcial en importaciones: el trabajo acumula `document_ids` y `records` como JSON y la tabla hija conserva resultados y la fila original. El código actual usa ambos; no son columnas que se puedan borrar sin adaptar API y frontend. Los `records` ocupan aproximadamente 175 KiB y `raw_row` aproximadamente 718 KiB de valores almacenados en esta muestra; estas medidas no equivalen al ahorro físico de una eliminación ni incluyen índices/espacio libre.

Además, se contaron 150 filas de importación con estado `pending` o `processing`. Se deben revisar como trabajos potencialmente pendientes, no tratarlas como historial descartable.

Acción propuesta: derivar el detalle desde las filas del trabajo y reducir copias JSON cuando se actualice ese flujo; acordar archivado o retención para datos operativos terminados. Conservar por separado documentos emitidos y trazabilidad necesaria. Este informe no define plazos legales de conservación.

### 5. Las relaciones de pertenencia existen, pero no todas aseguran la misma empresa

Ejemplo: un documento de nómina referencia tanto una empresa como un empleado, pero la FK del empleado solo comprueba su `id`; no comprueba que ese empleado pertenezca al mismo `company_id`. Ocurre algo similar con documento original, transmisiones, productos/categorías/impuestos y tablas que almacenan a la vez empresa e integración.

El código revisado aplica filtros por empresa en estos flujos y las comprobaciones de datos realizadas no encontraron cruces. No se ha demostrado un acceso indebido. Es una oportunidad para reforzar la integridad de futuros cambios o escrituras directas.

Acción propuesta: evaluar claves foráneas compuestas en las relaciones críticas, o garantías equivalentes. Hacerlo selectivamente: puede requerir índices únicos compuestos en los padres y no todos los enlaces justifican el mismo coste.

Tener `company_id` junto a `integration_id` no convierte automáticamente una relación en innecesaria: permite aislar y consultar datos por empresa. La decisión de conservar ambos debe considerar sus consultas y las garantías de consistencia.

### 6. Dos migraciones aplicadas no están en el árbol de código actual

La tabla `migrations` registra 111 entradas. No faltan por aplicar clases de migración presentes en el árbol revisado, pero aparecen dos nombres aplicados sin clase equivalente en el repositorio actual:

- `AddCityAndClientTypeToJarvisTerceros1745900000000`.
- `AddClientProfileFieldsToJarvisTerceros1746000000000`.

Acción propuesta: comprobar si se renombraron o retiraron y recuperar el historial reproducible cuando corresponda. No eliminar filas de `migrations` para ocultar la diferencia.

## Tablas que parecen prescindibles pero sí tienen función

| Tablas | Motivo para conservarlas actualmente |
| --- | --- |
| `product_taxes` | Relación de varios impuestos por producto mediante `@ManyToMany`/`@JoinTable`; no requiere consultas SQL literales para estar en uso |
| `product_price_lists` | Varias listas de precio por producto, con posición única |
| `product_catalog_seeds` | Una marca por empresa que usa una función/trigger para no recrear los productos genéricos editados o eliminados |
| `jarvis_tax_catalog_seeds` | Inicialización de impuestos una sola vez por empresa |
| `jarvis_payroll_employee_sequences` | Consecutivo de códigos de empleados, consumido por función/trigger; puede estar vacía y seguir siendo necesaria |
| `purchase_invoice_import_jobs` y `purchase_invoice_import_job_rows` | Cabecera del proceso y cola durable de filas, con reanudación y bloqueo de lotes |
| `jarvis_payroll_documents`, `jarvis_payroll_transmissions`, `jarvis_payroll_audit` | Documento, intentos de transmisión y acciones son hechos distintos; fusionarlos dificultaría conservar reintentos y auditoría |
| `migrations` | Historial del esquema administrado por TypeORM |

Dos pares podrían simplificarse en un rediseño futuro, pero no constituyen una limpieza urgente:

- Los medios de pago de facturación y nómina están en tablas separadas. Se podrían unificar con un ámbito o una configuración compartida, adaptando reglas y consumidores. Actualmente contienen solo 12 y 2 filas respectivamente y ocupan 40 y 56 KiB; no es una fuente relevante de crecimiento.
- Los marcadores de inicialización de productos e impuestos podrían vivir en una estructura de inicialización común o en atributos de configuración. Son tablas de una fila por empresa: el ahorro actual sería pequeño y habría que preservar la serialización concurrente y los triggers.

## Aclaración sobre Efectivo y Transferencia

En esta base hay **7 empresas y solo 1 tiene ambos medios de pago de nómina persistidos**. Esto precisa la explicación anterior: los dos se crean al consultar `PayrollService.paymentMethods()` por primera vez para cada empresa, no al registrar todas las empresas.

Si el requisito es que existan físicamente para todas desde el registro, hará falta una inicialización de las existentes y un flujo de alta para las nuevas que resuelva los identificadores reales del catálogo. No corresponde inventar esos identificadores ni copiar los de otra empresa sin verificar su procedencia.

## Orden recomendado de trabajo

1. Desactivar sincronización automática en bases persistentes y reconciliar esquema/migraciones. Revisar QA y producción por separado antes de trasladar conclusiones.
2. Resolver duplicados de proveedores e imponer unicidad coherente con la normalización del backend. Restituir las restricciones e índices esenciales que faltan.
3. Acordar la política de referencias a documentos eliminados y del historial operativo; corregir los registros afectados de forma controlada.
4. Revisar importaciones atascadas, reducir la duplicación de resultados y definir archivado para trabajos terminados/logs.
5. Reforzar pertenencia a empresa en las relaciones críticas. Medir consultas antes de crear índices para todas las FKs o retirar índices con pocos accesos.
6. Para funciones futuras, crear una tabla cuando el dato tenga identidad propia, varias filas relacionadas, consultas/indexación específicas o un ciclo de vida independiente. Usar configuración existente para banderas simples; evitar una tabla nueva por cada opción de pantalla.

PostgreSQL no crea automáticamente un índice en el lado que referencia una FK; su necesidad depende de consultas y operaciones sobre esas relaciones. Tampoco se debe inferir desuso permanente de un índice a partir de estadísticas acumuladas sin una ventana representativa: [restricciones](https://www.postgresql.org/docs/current/ddl-constraints.html), [estadísticas acumuladas](https://www.postgresql.org/docs/current/monitoring-stats.html).

## Inventario de tablas

Conteos observados durante la revisión. Los tamaños incluyen índices y almacenamiento auxiliar; no son únicamente el contenido lógico de las filas.

### Acceso y empresas

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `companies` | 7 | 64 |
| `users` | 6 | 48 |
| `user_companies` | 13 | 24 |
| `plans` | 12 | 48 |
| `integrations` | 9 | 264 |
| `integration_policy_acceptances` | 6 | 136 |
| `company_registration_invitations` | 0 | 24 |
| `password_reset_tokens` | 0 | 24 |
| `password_reset_attempts` | 0 | 16 |

### Documentos y preferencias SIIGO

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `electronic_documents` | 303 | 1936 |
| `historial_facturas` | 10526 | 10824 |
| `supplier_configurations` | 811 | 1088 |
| `supplier_item_account_mappings` | 2810 | 1200 |
| `siigo_accounts` | 1399 | 592 |
| `siigo_purchase_sync_jobs` | 87 | 88 |

### Importaciones e IA

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `purchase_invoice_import_jobs` | 34 | 496 |
| `purchase_invoice_import_job_rows` | 1303 | 1944 |
| `ai_generation_logs` | 900 | 504 |

### Facturación Jarvis

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `jarvis_sales_invoices` | 7 | 128 |
| `jarvis_invoice_drafts` | 1 | 64 |
| `jarvis_taxes` | 35 | 72 |
| `jarvis_tax_catalog_seeds` | 1 | 24 |
| `jarvis_terceros` | 4 | 48 |
| `jarvis_payment_methods` | 12 | 40 |
| `jarvis_sellers` | 3 | 40 |
| `jarvis_radian_events` | 2 | 120 |

### Productos

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `products` | 17 | 48 |
| `product_categories` | 2 | 40 |
| `product_price_lists` | 46 | 40 |
| `product_taxes` | 3 | 56 |
| `product_catalog_seeds` | 7 | 24 |

### Nómina

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `jarvis_payroll_settings` | 1 | 32 |
| `jarvis_payroll_parameters` | 0 | 80 |
| `jarvis_payroll_positions` | 2 | 40 |
| `jarvis_payroll_employees` | 4 | 64 |
| `jarvis_payroll_documents` | 0 | 112 |
| `jarvis_payroll_transmissions` | 0 | 88 |
| `jarvis_payroll_audit` | 85 | 64 |
| `jarvis_payroll_payment_methods` | 2 | 56 |
| `jarvis_payroll_employee_sequences` | 0 | 24 |

### Bold y esquema

| Tabla | Filas | KiB |
| --- | ---: | ---: |
| `bold_webhook_events` | 0 | 40 |
| `siigo_bold_cash_register` | 2 | 48 |
| `migrations` | 111 | 64 |

