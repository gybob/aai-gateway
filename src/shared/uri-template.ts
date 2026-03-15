const EXPRESSION_REGEX = /\{([^}]+)\}/g;
const RESERVED_OPERATOR_CHARS = new Set(['+', '#', '.', '/', ';', '?', '&']);

type UriOperator = '' | '+' | '#' | '.' | '/' | ';' | '?' | '&';
type PrimitiveValue = string | number | boolean;
type TemplateValue = PrimitiveValue | PrimitiveValue[] | Record<string, PrimitiveValue>;

interface VariableSpec {
  name: string;
  explode: boolean;
  prefixLength?: number;
}

const OPERATOR_CONFIG: Record<
  UriOperator,
  {
    prefix: string;
    separator: string;
    named: boolean;
    ifEmpty: string;
    allowReserved: boolean;
  }
> = {
  '': { prefix: '', separator: ',', named: false, ifEmpty: '', allowReserved: false },
  '+': { prefix: '', separator: ',', named: false, ifEmpty: '', allowReserved: true },
  '#': { prefix: '#', separator: ',', named: false, ifEmpty: '', allowReserved: true },
  '.': { prefix: '.', separator: '.', named: false, ifEmpty: '', allowReserved: false },
  '/': { prefix: '/', separator: '/', named: false, ifEmpty: '', allowReserved: false },
  ';': { prefix: ';', separator: ';', named: true, ifEmpty: '', allowReserved: false },
  '?': { prefix: '?', separator: '&', named: true, ifEmpty: '=', allowReserved: false },
  '&': { prefix: '&', separator: '&', named: true, ifEmpty: '=', allowReserved: false },
};

export function expandUriTemplate(template: string, variables: Record<string, unknown>): string {
  return template.replace(EXPRESSION_REGEX, (_match, expression: string) => {
    const operator = parseOperator(expression);
    const specs = parseSpecs(stripOperator(expression, operator));
    const expanded = expandExpression(operator, specs, variables);
    return expanded;
  });
}

export function listUriTemplateVariables(template: string): string[] {
  const names = new Set<string>();

  for (const match of template.matchAll(EXPRESSION_REGEX)) {
    const expression = match[1];
    if (!expression) {
      continue;
    }

    const operator = parseOperator(expression);
    for (const spec of parseSpecs(stripOperator(expression, operator))) {
      names.add(spec.name);
    }
  }

  return [...names];
}

function parseOperator(expression: string): UriOperator {
  const candidate = expression[0] ?? '';
  return RESERVED_OPERATOR_CHARS.has(candidate) ? (candidate as UriOperator) : '';
}

function stripOperator(expression: string, operator: UriOperator): string {
  return operator === '' ? expression : expression.slice(1);
}

function parseSpecs(expression: string): VariableSpec[] {
  return expression
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const explode = part.endsWith('*');
      const clean = explode ? part.slice(0, -1) : part;
      const [name, prefix] = clean.split(':');
      return {
        name,
        explode,
        prefixLength: prefix ? Number.parseInt(prefix, 10) : undefined,
      };
    });
}

function expandExpression(
  operator: UriOperator,
  specs: VariableSpec[],
  variables: Record<string, unknown>,
): string {
  const config = OPERATOR_CONFIG[operator];
  const parts = specs
    .flatMap((spec) => expandVariable(spec, operator, config, variables[spec.name]))
    .filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  return `${config.prefix}${parts.join(config.separator)}`;
}

function expandVariable(
  spec: VariableSpec,
  operator: UriOperator,
  config: (typeof OPERATOR_CONFIG)[UriOperator],
  value: unknown,
): string[] {
  const normalized = normalizeValue(value, spec.prefixLength);
  if (normalized === undefined) {
    return [];
  }

  if (Array.isArray(normalized)) {
    return expandArray(spec, operator, config, normalized);
  }

  if (isRecord(normalized)) {
    return expandObject(spec, operator, config, normalized);
  }

  return [formatPrimitive(spec.name, encodeValue(normalized, config.allowReserved), config, config.named)];
}

function expandArray(
  spec: VariableSpec,
  operator: UriOperator,
  config: (typeof OPERATOR_CONFIG)[UriOperator],
  values: PrimitiveValue[],
): string[] {
  const encoded = values.map((value) => encodeValue(value, config.allowReserved));

  if (spec.explode) {
    if (config.named && (operator === ';' || operator === '?' || operator === '&')) {
      return encoded.map((value) => formatPrimitive(spec.name, value, config, true));
    }

    return encoded;
  }

  const joined = encoded.join(',');
  return [formatPrimitive(spec.name, joined, config, config.named)];
}

function expandObject(
  spec: VariableSpec,
  operator: UriOperator,
  config: (typeof OPERATOR_CONFIG)[UriOperator],
  values: Record<string, PrimitiveValue>,
): string[] {
  const entries = Object.entries(values).map(([key, value]) => [
    encodeValue(key, config.allowReserved),
    encodeValue(value, config.allowReserved),
  ] as const);

  if (entries.length === 0) {
    return config.named ? [spec.name] : [];
  }

  if (spec.explode) {
    if (config.named && (operator === ';' || operator === '?' || operator === '&')) {
      return entries.map(([key, value]) => `${key}=${value}`);
    }

    return entries.map(([key, value]) => `${key}=${value}`);
  }

  const joined = entries.flatMap(([key, value]) => [key, value]).join(',');
  return [formatPrimitive(spec.name, joined, config, config.named)];
}

function formatPrimitive(name: string, value: string, config: (typeof OPERATOR_CONFIG)[UriOperator], named: boolean): string {
  const stringValue = value;
  if (!named) {
    return stringValue;
  }

  if (stringValue.length === 0) {
    return `${name}${config.ifEmpty}`;
  }

  return `${name}=${stringValue}`;
}

function normalizeValue(value: unknown, prefixLength?: number): TemplateValue | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return prefixLength ? value.slice(0, prefixLength) : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter(isPrimitiveValue);
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, PrimitiveValue] => isPrimitiveValue(entry[1])),
    );
  }

  return undefined;
}

function encodeValue(value: PrimitiveValue, allowReserved: boolean): string {
  const stringValue = String(value);
  if (allowReserved) {
    return encodeURI(stringValue).replace(/%5B/g, '[').replace(/%5D/g, ']');
  }
  return encodeURIComponent(stringValue);
}

function isPrimitiveValue(value: unknown): value is PrimitiveValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, PrimitiveValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
