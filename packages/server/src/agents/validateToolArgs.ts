import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Validates tool arguments against a tool's JSON Schema input definition.
 *
 * A fresh Ajv instance per call: Ajv caches compiled schemas by object identity,
 * and tool schemas arrive as new objects on every run, so a shared instance
 * would grow without bound. Approvals are user-paced, so compile cost is negligible.
 *
 * @returns undefined when the arguments are valid, otherwise a readable error text
 */
export function validateToolArgs(schema: object, args: unknown): string | undefined {
  const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);

  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    return `the tool's input schema could not be compiled: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (validate(args)) return undefined;
  return ajv.errorsText(validate.errors, { dataVar: 'args' });
}
