/**
 * Schema validation utilities for tool parameters
 */

import { AaiError } from '../errors/errors.js';

export interface ValidationError {
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate arguments against a JSON Schema (simplified validation)
 */
export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, unknown>
): ValidationResult {
  const errors: ValidationError[] = [];
  const properties = schema.properties as Record<string, unknown> | undefined;
  const required = (schema.required as string[]) || [];

  // Check required fields
  for (const field of required) {
    if (!(field in args) || args[field] === undefined || args[field] === null) {
      errors.push({
        path: field,
        message: `缺少必需参数 '${field}'`,
        expected: 'any non-null value',
      });
    }
  }

  // Validate provided fields
  for (const [key, value] of Object.entries(args)) {
    if (!properties || !properties[key]) {
      // Unknown field - skip for now (allow additionalProperties)
      continue;
    }

    const propSchema = properties[key] as Record<string, unknown>;
    const fieldErrors = validateField(key, value, propSchema);
    errors.push(...fieldErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single field value against its schema
 */
function validateField(path: string, value: unknown, schema: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const type = schema.type as string | undefined;

  if (type) {
    const typeErrors = validateType(path, value, type);
    if (typeErrors) {
      errors.push(typeErrors);
    }
  }

  // Validate enum values
  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push({
        path,
        message: `参数 '${path}' 的值无效`,
        expected: schema.enum.join(' | '),
        actual: String(value),
      });
    }
  }

  // Validate array items
  if (type === 'array' && Array.isArray(value)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      value.forEach((item, index) => {
        const itemErrors = validateField(`${path}[${index}]`, item, items);
        errors.push(...itemErrors);
      });
    }
  }

  // Validate object properties
  if (type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        const itemErrors = validateField(`${path}.${key}`, (value as Record<string, unknown>)[key], propSchema as Record<string, unknown>);
        errors.push(...itemErrors);
      }
    }
  }

  return errors;
}

/**
 * Validate a value against an expected type
 */
function validateType(path: string, value: unknown, expectedType: string): ValidationError | null {
  const actualType = getType(value);

  // Handle union types like "string | null"
  const types = expectedType.split('|').map(t => t.trim());
  
  for (const type of types) {
    if (type === 'any') return null;
    if (type === 'null' && value === null) return null;
    if (type === 'array' && Array.isArray(value)) return null;
    if (type === 'object' && actualType === 'object' && value !== null && !Array.isArray(value)) return null;
    if (actualType === type) return null;
  }

  return {
    path,
    message: `参数 '${path}' 类型错误`,
    expected: expectedType,
    actual: actualType === 'object' ? (Array.isArray(value) ? 'array' : 'object') : actualType,
  };
}

/**
 * Get the JSON Schema type of a value
 */
function getType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/**
 * Format validation errors into a user-friendly message
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.valid) return '';

  const messages = result.errors.map(err => {
    if (err.expected && err.actual) {
      return `  - ${err.message}: 期望 ${err.expected}, 实际得到 ${err.actual}`;
    } else if (err.expected) {
      return `  - ${err.message}: 期望 ${err.expected}`;
    }
    return `  - ${err.message}`;
  });

  return messages.join('\n');
}

/**
 * Create an INVALID_PARAMS error with schema guidance
 */
export function createSchemaValidationError(
  toolName: string,
  result: ValidationResult,
  schema: Record<string, unknown>
): AaiError {
  const message = `参数校验失败 for '${toolName}'\n${formatValidationErrors(result)}`;
  
  return new AaiError('INVALID_PARAMS', message, {
    schema,
    validationErrors: result.errors,
    suggestion: '请检查参数格式并参考返回的 schema 重试',
  });
}
