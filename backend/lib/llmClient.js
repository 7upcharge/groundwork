const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-5';
const REQUEST_TIMEOUT_MS = 20000;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

function isLlmAvailable() {
  return getClient() !== null;
}

/**
 * Calls Claude with a single forced tool-use so the response is guaranteed
 * to be well-formed JSON matching `schema`, instead of free-form prose we'd
 * have to hope parses correctly. Throws on any failure so callers can fall
 * back to the deterministic offline engine.
 */
async function callStructured({ system, prompt, toolName, schema, maxTokens = 2000 }) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('LLM not configured (ANTHROPIC_API_KEY missing).');

  const response = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name: toolName, description: `Return ${toolName} as structured data.`, input_schema: schema }],
      tool_choice: { type: 'tool', name: toolName },
    },
    { timeout: REQUEST_TIMEOUT_MS }
  );

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('LLM did not return structured output.');
  return toolUse.input;
}

module.exports = { callStructured, isLlmAvailable, MODEL };
