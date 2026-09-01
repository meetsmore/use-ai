import React from 'react';
import type { ChatStreamingPart, PersistedMessage } from '@meetsmore-oss/use-ai-client';

/**
 * Rendering pieces for the component-slots demo.
 *
 * The built-in `Message` slot renders one turn as a single bubble. These pieces
 * take the same turn apart again using `sourceMessages` and lay it out as a
 * timeline: reasoning, tool cards and prose appear in the order the model
 * produced them, and the sources a tool returned are pinned under the answer.
 */

// ── LaTeX ───────────────────────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ',
  mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', phi: 'φ', omega: 'ω',
  Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω',
  times: '×', cdot: '·', pm: '±', leq: '≤', geq: '≥', neq: '≠',
  approx: '≈', infty: '∞', rightarrow: '→', partial: '∂', int: '∫', sum: '∑',
};

/** Reads a `{...}` group starting at `i`, returning its body and the index after it. */
function readGroup(tex: string, i: number): [string, number] {
  if (tex[i] !== '{') return [tex[i] ?? '', i + 1];
  let depth = 0;
  for (let j = i; j < tex.length; j++) {
    if (tex[j] === '{') depth++;
    else if (tex[j] === '}' && --depth === 0) return [tex.slice(i + 1, j), j + 1];
  }
  return [tex.slice(i + 1), tex.length];
}

/**
 * A deliberately small TeX subset: fractions, roots, super/subscripts and the
 * symbols above. Enough to show that the slot owns the renderer; a real app
 * would hand the same string to KaTeX or MathJax here.
 */
function renderMath(tex: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buffer = '';
  let i = 0;

  const flush = () => {
    if (buffer) {
      out.push(buffer);
      buffer = '';
    }
  };

  while (i < tex.length) {
    const char = tex[i];

    if (char === '\\') {
      const command = /^[a-zA-Z]+/.exec(tex.slice(i + 1))?.[0];
      if (!command) { buffer += tex[i + 1] ?? ''; i += 2; continue; }
      i += 1 + command.length;

      if (command === 'frac') {
        const [numerator, afterNum] = readGroup(tex, i);
        const [denominator, afterDen] = readGroup(tex, afterNum);
        i = afterDen;
        flush();
        out.push(
          <span className="orbit-frac" key={`${keyPrefix}-f${i}`}>
            <span>{renderMath(numerator, `${keyPrefix}-fn${i}`)}</span>
            <span>{renderMath(denominator, `${keyPrefix}-fd${i}`)}</span>
          </span>
        );
        continue;
      }

      if (command === 'sqrt') {
        const [body, after] = readGroup(tex, i);
        i = after;
        flush();
        out.push(
          <span className="orbit-sqrt" key={`${keyPrefix}-r${i}`}>
            {renderMath(body, `${keyPrefix}-rb${i}`)}
          </span>
        );
        continue;
      }

      buffer += SYMBOLS[command] ?? command;
      continue;
    }

    if (char === '^' || char === '_') {
      const [body, after] = readGroup(tex, i + 1);
      i = after;
      flush();
      const Tag = char === '^' ? 'sup' : 'sub';
      out.push(<Tag key={`${keyPrefix}-s${i}`}>{renderMath(body, `${keyPrefix}-sb${i}`)}</Tag>);
      continue;
    }

    buffer += char;
    i++;
  }

  flush();
  return out;
}

/**
 * Assistant prose with `$…$` inline and `$$…$$` display math pulled out.
 *
 * The answer is laid out one line per element instead of one node for the whole
 * text. Rewriting a text node collapses any live range inside it: the DOM spec
 * moves a range's offsets to the start of the replaced data, so a selection
 * dies. Holding the whole answer in a single node would rewrite it on every
 * token and drop the user's selection each time. Split this way, React leaves
 * a line whose string did not change untouched, so everything already written
 * stays selectable while the answer continues. Only the line currently being
 * written churns.
 *
 * Split results are kept unfiltered for the same reason: dropping the empty
 * strings would renumber the keys as the answer grows.
 */
export function OrbitProse({ text }: { text: string }) {
  const segments = text.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g);

  return (
    <div className="orbit-message-bubble" data-testid="orbit-prose">
      {segments.map((segment, index) => {
        if (segment.startsWith('$$') && segment.endsWith('$$')) {
          return (
            <span className="orbit-math is-block" key={index} data-testid="orbit-math-block">
              {renderMath(segment.slice(2, -2).trim(), `b${index}`)}
            </span>
          );
        }
        if (segment.startsWith('$') && segment.endsWith('$') && segment.length > 2) {
          return (
            <span className="orbit-math" key={index} data-testid="orbit-math-inline">
              {renderMath(segment.slice(1, -1).trim(), `i${index}`)}
            </span>
          );
        }
        // The separators are kept as their own nodes; the bubble is pre-wrap,
        // so the rendered text reads exactly as it did in one node.
        return segment.split(/(\n)/).map((line, lineIndex) => (
          <span key={`${index}-${lineIndex}`}>{line}</span>
        ));
      })}
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

export interface TimelineEntry {
  kind: 'reasoning' | 'text' | 'tool';
  key: string;
  text?: string;
  toolCallId?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function messageText(content: PersistedMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => ('text' in part ? part.text : '')).join('');
}

/**
 * Flattens a turn into the order the model produced it. Reasoning is placed
 * before the text of the step it belongs to, which is the only ordering the
 * persisted shape records (reasoning lives in its own field, not inline).
 *
 * Entry keys are ordinals within the turn rather than message ids, so that
 * `buildStreamingTimeline` can produce the same key for the same entry. Only
 * the final step's id is known while a run is in flight; the earlier steps get
 * theirs when the turn is persisted, so any id-derived key would change under
 * React the moment the run finishes and remount the prose, dropping a
 * selection the user was making inside it.
 */
export function buildTimeline(sourceMessages: PersistedMessage[]): TimelineEntry[] {
  const results = new Map<string, unknown>();
  for (const message of sourceMessages) {
    if (message.role === 'tool' && message.toolCallId) {
      results.set(message.toolCallId, parseJson(messageText(message.content)));
    }
  }

  const entries: TimelineEntry[] = [];
  const ordinals = { reasoning: 0, text: 0 };
  for (const message of sourceMessages) {
    if (message.role !== 'assistant') continue;

    message.reasoningParts?.forEach((part) => {
      if (part.text.trim()) {
        entries.push({ kind: 'reasoning', key: `r${ordinals.reasoning++}`, text: part.text });
      }
    });

    const text = messageText(message.content).trim();
    if (text) {
      entries.push({ kind: 'text', key: `t${ordinals.text++}`, text });
    }

    message.toolCalls?.forEach((call) => {
      entries.push({
        kind: 'tool',
        key: call.id,
        toolCallId: call.id,
        name: call.function.name,
        args: parseJson(call.function.arguments),
        result: results.get(call.id),
      });
    });
  }

  return entries;
}

/**
 * The same flattening for a run still in flight. The parts already arrive in
 * order, so this only reshapes them; results are not known yet, which is what
 * leaves the tool cards in their pending state.
 *
 * Ordinals are counted exactly as `buildTimeline` counts them, which is what
 * keeps an entry's key stable when the run finishes and the persisted turn
 * takes over. Both walk the same turn in the same order and drop blank text the
 * same way, so the nth text entry here is the nth text entry there.
 */
export function buildStreamingTimeline(parts: ChatStreamingPart[]): TimelineEntry[] {
  const ordinals = { reasoning: 0, text: 0 };

  return parts.flatMap((part) => {
    if (part.kind === 'tool_call') {
      return [{
        kind: 'tool' as const,
        key: part.toolCallId,
        toolCallId: part.toolCallId,
        name: part.name,
        args: parseJson(part.args),
      }];
    }
    if (!part.text.trim()) return [];

    const key = part.kind === 'reasoning'
      ? `r${ordinals.reasoning++}`
      : `t${ordinals.text++}`;
    return [{ kind: part.kind, key, text: part.text }];
  });
}

export function OrbitReasoning({ text, open }: { text: string; open?: boolean }) {
  return (
    <details className="orbit-reasoning" data-testid="orbit-reasoning" open={open}>
      <summary>Thinking</summary>
      <p>{text}</p>
    </details>
  );
}

export function OrbitToolCard({ entry }: { entry: TimelineEntry }) {
  // While a call streams its arguments are half-parsed JSON, so only show them
  // once they parse into an object.
  const args =
    typeof entry.args === 'object' && entry.args !== null && !Array.isArray(entry.args)
      ? (entry.args as Record<string, unknown>)
      : undefined;
  const pending = entry.result === undefined;

  return (
    <div className={`orbit-tool-card ${pending ? 'is-pending' : ''}`} data-testid="orbit-tool-card">
      <div className="orbit-tool-head">
        <span className="orbit-tool-glyph" aria-hidden="true">⌘</span>
        <strong>{entry.name}</strong>
        <span className="orbit-tool-state">{pending ? 'running' : 'done'}</span>
      </div>
      {args && Object.keys(args).length > 0 && (
        <dl className="orbit-tool-args">
          {Object.entries(args).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ── Citations ───────────────────────────────────────────────────────────────

export interface OrbitSource {
  title: string;
  url: string;
  snippet?: string;
}

function isSource(value: unknown): value is OrbitSource {
  return (
    typeof value === 'object' && value !== null &&
    typeof (value as OrbitSource).title === 'string' &&
    typeof (value as OrbitSource).url === 'string'
  );
}

/** Collects the `sources` a tool returned, de-duplicated by url. */
export function collectSources(entries: TimelineEntry[]): OrbitSource[] {
  const byUrl = new Map<string, OrbitSource>();

  for (const entry of entries) {
    const sources = (entry.result as { sources?: unknown })?.sources;
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      if (isSource(source) && !byUrl.has(source.url)) byUrl.set(source.url, source);
    }
  }

  return [...byUrl.values()];
}

export function OrbitCitations({ sources }: { sources: OrbitSource[] }) {
  return (
    <div className="orbit-citations" data-testid="orbit-citations">
      <p className="orbit-kicker">SOURCES</p>
      <div className="orbit-citation-row">
        {sources.map((source, index) => (
          <a
            key={source.url}
            className="orbit-citation"
            href={source.url}
            target="_blank"
            rel="noreferrer"
            data-testid="orbit-citation"
          >
            <span>{index + 1}</span>
            <strong>{source.title}</strong>
            {source.snippet && <small>{source.snippet}</small>}
            <em>{new URL(source.url).hostname}</em>
          </a>
        ))}
      </div>
    </div>
  );
}
