const { validate } = require('./schema');

class LlmError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // timeout | http | blocked | parse | schema | config
  }
}

function toGeminiSchema(schema) {
  const out = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, s]) => [k, toGeminiSchema(s)]));
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.minItems !== undefined) out.minItems = schema.minItems;
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
  return out;
}

async function postJson(fetchImpl, url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        detail = JSON.parse(text).error?.message || detail;
      } catch {}
      throw new LlmError('http', `HTTP ${res.status}: ${detail}`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (err.name === 'AbortError') throw new LlmError('timeout', `Model did not respond within ${timeoutMs}ms`);
    throw new LlmError('http', err.message);
  } finally {
    clearTimeout(timer);
  }
}

function geminiProvider({ key, model, timeoutMs, fetchImpl }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    name: 'gemini',
    model,
    async complete({ system, prompt, schema, temperature, maxOutputTokens }) {
      const data = await postJson(
        fetchImpl,
        url,
        { 'x-goog-api-key': key },
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(schema),
          },
        },
        timeoutMs
      );
      if (data.promptFeedback?.blockReason) throw new LlmError('blocked', `Blocked: ${data.promptFeedback.blockReason}`);
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text) throw new LlmError('parse', `Empty response (finishReason: ${candidate?.finishReason || 'none'})`);
      return text;
    },
  };
}

function anthropicProvider({ key, model, timeoutMs, fetchImpl }) {
  return {
    name: 'anthropic',
    model,
    async complete({ system, prompt, schema, temperature, maxOutputTokens }) {
      const data = await postJson(
        fetchImpl,
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          system,
          max_tokens: maxOutputTokens,
          temperature,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ name: 'respond', description: 'Return the result.', input_schema: schema }],
          tool_choice: { type: 'tool', name: 'respond' },
        },
        timeoutMs
      );
      const tool = data.content?.find((b) => b.type === 'tool_use');
      if (!tool) throw new LlmError('parse', 'No structured output returned');
      return JSON.stringify(tool.input);
    },
  };
}

/**
 * Returns null when no model is configured; callers then use the offline
 * engine. `generateJson` parses and schema-checks the output and throws a
 * typed LlmError, so agents can decide whether to repair, retry or fall back.
 */
function createLlm(llmConfig, { fetchImpl = fetch, provider } = {}) {
  let impl = provider || null;
  if (!impl && llmConfig.geminiKey) {
    impl = geminiProvider({ key: llmConfig.geminiKey, model: llmConfig.geminiModel, timeoutMs: llmConfig.timeoutMs, fetchImpl });
  } else if (!impl && llmConfig.anthropicKey) {
    impl = anthropicProvider({ key: llmConfig.anthropicKey, model: llmConfig.anthropicModel, timeoutMs: llmConfig.timeoutMs, fetchImpl });
  }
  if (!impl) return null;

  return {
    name: impl.name,
    model: impl.model,
    async generateJson({ system, prompt, schema, temperature = 0.2, maxOutputTokens = 4096 }) {
      const text = await impl.complete({ system, prompt, schema, temperature, maxOutputTokens });
      let parsed;
      try {
        parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      } catch {
        throw new LlmError('parse', 'Response was not valid JSON');
      }
      const errors = validate(parsed, schema);
      if (errors.length) {
        const err = new LlmError('schema', `Response did not match schema: ${errors.slice(0, 5).join('; ')}`);
        err.partial = parsed;
        throw err;
      }
      return parsed;
    },
  };
}

module.exports = { createLlm, LlmError, toGeminiSchema };
