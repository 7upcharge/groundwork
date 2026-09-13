// Minimal JSON-schema checker for model output. Providers are asked for
// structured JSON, but output is still validated here: a response that parses
// but has the wrong shape is fed back into the repair loop, not trusted.
function validate(value, schema, path = '$') {
  const errors = [];
  const fail = (msg) => errors.push(`${path}: ${msg}`);

  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('expected object');
        break;
      }
      for (const key of schema.required || []) if (!(key in value)) fail(`missing "${key}"`);
      for (const [key, sub] of Object.entries(schema.properties || {})) {
        if (value[key] !== undefined && value[key] !== null) errors.push(...validate(value[key], sub, `${path}.${key}`));
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) {
        fail('expected array');
        break;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) fail(`expected at least ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`expected at most ${schema.maxItems} items`);
      value.forEach((item, i) => errors.push(...validate(item, schema.items, `${path}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') fail('expected string');
      else if (schema.enum && !schema.enum.includes(value)) fail(`expected one of ${schema.enum.join(', ')}`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) fail('expected integer');
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) fail('expected number');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('expected boolean');
      break;
    default:
      break;
  }
  return errors;
}

module.exports = { validate };
