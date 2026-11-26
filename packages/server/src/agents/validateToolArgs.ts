import Ajv, { type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

/** JSON Schema dialect used to read a tool's input schema. */
type JsonSchemaDialect = 'draft-07' | '2020-12';

type CompileResult = { validate: ValidateFunction; ajv: Ajv } | { error: string };

/**
 * Compiled validators, keyed by schema object and dialect. Weak keys let a schema
 * and its validator be collected once no tool definition references it. Each entry
 * owns its Ajv instance, because Ajv's own cache holds schemas strongly.
 */
const compiled = new WeakMap<object, Map<JsonSchemaDialect, CompileResult>>();

function compile(schema: object, dialect: JsonSchemaDialect): CompileResult {
  let byDialect = compiled.get(schema);
  const cached = byDialect?.get(dialect);
  if (cached) return cached;

  const options = { allErrors: true, strict: false, validateSchema: false };
  const ajv = dialect === '2020-12' ? new Ajv2020(options) : new Ajv(options);
  addFormats(ajv);
  let result: CompileResult;
  try {
    result = { validate: ajv.compile(schema), ajv };
  } catch (error) {
    result = { error: `the tool's input schema could not be compiled: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (!byDialect) {
    byDialect = new Map();
    compiled.set(schema, byDialect);
  }
  byDialect.set(dialect, result);
  return result;
}

/**
 * Validates tool arguments against a JSON Schema.
 *
 * @returns undefined when the arguments are valid, otherwise a readable error text
 */
export function validateJsonSchemaArgs(
  schema: object,
  args: unknown,
  dialect: JsonSchemaDialect
): string | undefined {
  const result = compile(schema, dialect);
  if ('error' in result) return result.error;
  if (result.validate(args)) return undefined;
  return result.ajv.errorsText(result.validate.errors, { dataVar: 'args' });
}
