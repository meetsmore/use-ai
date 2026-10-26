import { describe, expect, test } from 'bun:test';
import { createMockReasoningModel } from './MockReasoningModel';

type Message = { role: string; content: unknown };

/** Streams one mock response and joins its reasoning and text deltas. */
async function respond(prompt: Message[]): Promise<{ reasoning: string; text: string }> {
  const model = createMockReasoningModel({ chunkDelayInMs: 0 });
  const { stream } = await model.doStream({ prompt } as never);
  let reasoning = '';
  let text = '';
  const reader = stream.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    if (chunk.value.type === 'reasoning-delta') reasoning += chunk.value.delta;
    if (chunk.value.type === 'text-delta') text += chunk.value.delta;
  }
  return { reasoning, text };
}

const user = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const assistant = (text: string): Message => ({ role: 'assistant', content: [{ type: 'text', text }] });

describe('createMockReasoningModel', () => {
  test('reasoning quotes the prompt it answers', async () => {
    const { reasoning } = await respond([user('Reply with the single word BRAVO and nothing else.')]);

    expect(reasoning).toContain('The user asked: "Reply with the single word BRAVO and nothing else."');
  });

  test('long reasoning walks through the words of the prompt', async () => {
    const { reasoning } = await respond([user('Reply with the single word BRAVO. Use long reasoning.')]);

    expect(reasoning).toContain('Step 6: the request contains "BRAVO.".');
    expect(reasoning).not.toContain('15!');
  });

  test('counts and ends with the requested word', async () => {
    const { text } = await respond([
      user('Count from 1 to 300, one number per line. After the last number, write the single word ALPHA.'),
    ]);

    const lines = text.split('\n');
    expect(lines).toHaveLength(301);
    expect(lines[0]).toBe('1');
    expect(lines[299]).toBe('300');
    expect(lines[300]).toBe('ALPHA');
  });

  test('replies with the single word asked for', async () => {
    const { text } = await respond([user('Reply with the single word BRAVO and nothing else.')]);

    expect(text).toBe('BRAVO');
  });

  test('names the last word of the previous reply in the same prompt', async () => {
    const { text } = await respond([
      user('Count from 1 to 3. After the last number, write the single word ALPHA.'),
      assistant('1\n2\n3\nALPHA'),
      user('Which word did you write at the end of your previous answer in this chat?'),
    ]);

    expect(text).toBe('ALPHA');
  });

  test('says so when the prompt holds no previous reply', async () => {
    const { text } = await respond([user('Which word did you write at the end of your previous answer in this chat?')]);

    expect(text).toBe('There is no previous answer in this chat.');
  });

  test('any other prompt gets a reply that quotes it', async () => {
    const { text } = await respond([user('hello')]);

    expect(text).toContain('Mock reply to "hello".');
  });
});
