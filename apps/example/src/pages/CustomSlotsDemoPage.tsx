import React from 'react';
import { z } from 'zod';
import {
  UseAIChat,
  useAI,
  defineTool,
  type ChatComposerSlotProps,
  type ChatDisclaimerSlotProps,
  type ChatEmptyStateSlotProps,
  type ChatHeaderSlotProps,
  type ChatMessageSlotProps,
  type ChatPendingIndicatorSlotProps,
  type ChatToolApprovalSlotProps,
  type PersistedMessageContent,
  type UseAIChatComponentOverrides,
} from '@meetsmore-oss/use-ai-client';
import {
  OrbitCitations,
  OrbitProse,
  OrbitReasoning,
  OrbitToolCard,
  buildStreamingTimeline,
  buildTimeline,
  collectSources,
} from './orbitTimeline';

const FALLBACK_SUGGESTIONS = [
  'Look up how component slots work and cite your sources',
  'Work out the orbital period for a 7000 km radius, with the formula',
  'Search the handbook for tool approval, then summarize it',
];

function contentToText(content: PersistedMessageContent): string {
  if (typeof content === 'string') return content;

  return content
    .map((part) => {
      if (part.type === 'text' || part.type === 'transformed_file') return part.text;
      if (part.type === 'file') return `Attachment: ${part.file.name}`;
      if (part.type === 'attachment_ref') return `Attachment: ${part.name}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function OrbitHeader({
  connected,
  messages,
  availableAgents,
  defaultAgent,
  selectedAgent,
  onAgentChange,
  onNewChat,
}: ChatHeaderSlotProps) {
  const activeAgent = availableAgents.find((agent) => agent.id === (selectedAgent ?? defaultAgent));

  return (
    <header className="orbit-header" data-testid="orbit-header">
      <div className="orbit-brand-mark" aria-hidden="true">
        <span />
      </div>
      <div className="orbit-brand-copy">
        <span className="orbit-eyebrow">WORKSPACE COPILOT</span>
        <strong>Orbit</strong>
      </div>
      <div className="orbit-header-actions">
        {availableAgents.length > 1 && onAgentChange ? (
          <select
            aria-label="Select Orbit agent"
            className="orbit-agent-select"
            value={selectedAgent ?? defaultAgent ?? ''}
            onChange={(event) => onAgentChange(event.target.value === defaultAgent ? null : event.target.value)}
          >
            {availableAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        ) : (
          <span className="orbit-agent-name">{activeAgent?.name ?? 'General'}</span>
        )}
        <span className={`orbit-status ${connected ? 'is-online' : ''}`}>
          <span aria-hidden="true" />
          {connected ? 'Live' : 'Offline'}
        </span>
        {onNewChat && (
          <button
            type="button"
            className="orbit-icon-button"
            onClick={() => void onNewChat()}
            title="Start a new conversation"
            aria-label="Start a new conversation"
            disabled={messages.length === 0}
          >
            +
          </button>
        )}
      </div>
    </header>
  );
}

function OrbitEmptyState({ suggestions, connected, loading, onSelectSuggestion }: ChatEmptyStateSlotProps) {
  const prompts = suggestions.length > 0 ? suggestions : FALLBACK_SUGGESTIONS;

  return (
    <section className="orbit-empty" data-testid="orbit-empty-state">
      <div className="orbit-orb" aria-hidden="true">
        <div />
      </div>
      <p className="orbit-kicker">READY WHEN YOU ARE</p>
      <h2>Make space for<br /><em>better work.</em></h2>
      <p className="orbit-intro">
        Ask Orbit to plan, summarize, calculate, or move through this example app with you.
      </p>
      <div className="orbit-prompts">
        {prompts.slice(0, 3).map((prompt, index) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelectSuggestion(prompt)}
            disabled={!connected || loading}
            data-testid="orbit-suggestion"
          >
            <span>0{index + 1}</span>
            {prompt}
            <b aria-hidden="true">↗</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function OrbitMessage({
  message,
  sourceMessages,
  streaming,
  streamingParts,
}: ChatMessageSlotProps) {
  const isUser = message.role === 'user';
  const text = contentToText(message.content);

  if (isUser) {
    return (
      <article className="orbit-message is-user" data-testid="orbit-message">
        <div className="orbit-avatar" aria-hidden="true">Y</div>
        <div className="orbit-message-body">
          <div className="orbit-message-meta">
            <strong>You</strong>
            <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div className="orbit-message-bubble">{text}</div>
        </div>
      </article>
    );
  }

  // A run in flight and a persisted turn reduce to the same entries, so the
  // layout below does not change when the answer completes.
  const entries = streaming ? buildStreamingTimeline(streamingParts) : buildTimeline(sourceMessages);
  const sources = collectSources(entries);
  const lastEntry = entries[entries.length - 1];

  return (
    <article
      className="orbit-message"
      data-testid={streaming ? 'orbit-streaming-message' : 'orbit-message'}
    >
      <div className={`orbit-avatar ${streaming ? 'orbit-avatar-pulse' : ''}`} aria-hidden="true">O</div>
      <div className="orbit-message-body">
        <div className="orbit-message-meta">
          <strong>Orbit</strong>
          {streaming ? (
            <span className="orbit-writing">
              <i /><i /><i />{' '}
              {lastEntry?.kind === 'reasoning' ? 'Thinking through the details'
                : lastEntry?.kind === 'tool' ? `Running ${lastEntry.name}`
                : 'Writing a response'}
            </span>
          ) : (
            <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
        {entries.length === 0 ? (
          <OrbitProse text={text || 'Completed.'} />
        ) : (
          entries.map((entry) => {
            if (entry.kind === 'reasoning') {
              // Open the block still being written so the run reads as it happens.
              return <OrbitReasoning key={entry.key} text={entry.text!} open={streaming && entry === lastEntry} />;
            }
            if (entry.kind === 'tool') return <OrbitToolCard key={entry.key} entry={entry} />;
            return <OrbitProse key={entry.key} text={entry.text!} />;
          })
        )}
        {sources.length > 0 && <OrbitCitations sources={sources} />}
      </div>
    </article>
  );
}

function OrbitPendingIndicator({ executingTool, fileProcessing }: ChatPendingIndicatorSlotProps) {
  const activity = executingTool?.displayText
    ?? (fileProcessing ? 'Reading your attachment' : 'Getting started');

  return (
    <article className="orbit-message" data-testid="orbit-pending-indicator">
      <div className="orbit-avatar orbit-avatar-pulse" aria-hidden="true">O</div>
      <div className="orbit-message-body">
        <div className="orbit-message-meta">
          <strong>Orbit</strong>
          <span className="orbit-writing"><i /><i /><i /> {activity}</span>
        </div>
      </div>
    </article>
  );
}

function OrbitComposer({
  input,
  connected,
  loading,
  placeholder,
  canSend,
  canAbort,
  attachments,
  fileUploadEnabled,
  fileError,
  pendingApprovals,
  onInputChange,
  onSend,
  onAbort,
  onOpenFilePicker,
  onRemoveAttachment,
}: ChatComposerSlotProps) {
  // ToolApproval is rendered independently by use-ai. Hide the composer while
  // an approval is pending to match the built-in interaction pattern.
  if (pendingApprovals.length > 0) return null;

  return (
    <footer className="orbit-composer-wrap" data-testid="orbit-composer">
      {attachments.length > 0 && (
        <div className="orbit-attachments">
          {attachments.map((attachment) => (
            <button key={attachment.id} type="button" onClick={() => onRemoveAttachment(attachment.id)}>
              {attachment.file.name} <span>×</span>
            </button>
          ))}
        </div>
      )}
      {fileError && <p className="orbit-file-error">{fileError}</p>}
      <div className="orbit-composer">
        <textarea
          aria-label="Message Orbit"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={!connected}
        />
        <div className="orbit-composer-actions">
          <div>
            {fileUploadEnabled && (
              <button type="button" onClick={onOpenFilePicker} className="orbit-attach-button">
                <span aria-hidden="true">＋</span> Add context
              </button>
            )}
            <small>{connected ? 'Enter to send · Shift + Enter for a new line' : 'Waiting for the server…'}</small>
          </div>
          {canAbort ? (
            <button type="button" className="orbit-send-button is-stop" onClick={onAbort} aria-label="Stop response">
              ■
            </button>
          ) : (
            <button
              type="button"
              className="orbit-send-button"
              onClick={onSend}
              disabled={!canSend || loading}
              aria-label="Send message"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}

function OrbitToolApproval({ approvals, onApprove, onReject }: ChatToolApprovalSlotProps) {
  const firstApproval = approvals[0];
  if (!firstApproval) return null;

  return (
    <aside className="orbit-approval" data-testid="orbit-tool-approval">
      <span className="orbit-approval-icon" aria-hidden="true">!</span>
      <div>
        <p>Permission requested</p>
        <strong>{firstApproval.annotations?.title ?? firstApproval.toolCallName}</strong>
        {approvals.length > 1 && <small> + {approvals.length - 1} more actions</small>}
      </div>
      <button type="button" onClick={() => onReject('Declined in Orbit custom UI')}>Decline</button>
      <button type="button" className="is-approve" onClick={onApprove}>Allow once</button>
    </aside>
  );
}

function OrbitDisclaimer({ text }: ChatDisclaimerSlotProps) {
  return (
    <p className="orbit-disclaimer" data-testid="orbit-disclaimer">
      <span aria-hidden="true">✦</span> {text}
    </p>
  );
}

const orbitComponents: UseAIChatComponentOverrides = {
  Header: OrbitHeader,
  EmptyState: OrbitEmptyState,
  Message: OrbitMessage,
  PendingIndicator: OrbitPendingIndicator,
  Composer: OrbitComposer,
  ToolApproval: OrbitToolApproval,
  Disclaimer: OrbitDisclaimer,
};

/**
 * Stand-in search index. The point of the demo is the rendering, so the
 * "sources" are fixed rather than fetched.
 */
const HANDBOOK = [
  {
    title: 'Component slots',
    url: 'https://example.com/handbook/component-slots',
    snippet: 'Each region of the chat is a React component the host app supplies.',
    body: 'Slots receive live chat state and callbacks. Omit children to replace a region outright.',
  },
  {
    title: 'Tool approval',
    url: 'https://example.com/handbook/tool-approval',
    snippet: 'Tools marked destructive wait for an explicit confirmation.',
    body: 'A tool annotated with destructiveHint pauses the run until the user approves it.',
  },
  {
    title: 'Chat history',
    url: 'https://example.com/handbook/chat-history',
    snippet: 'Conversations persist through a ChatRepository.',
    body: 'The default repository stores the twenty most recent chats in localStorage.',
  },
];

const searchHandbook = defineTool(
  'Search the Orbit handbook. Returns matching passages and the sources they came from.',
  z.object({ query: z.string() }),
  ({ query }) => {
    const needle = query.toLowerCase();
    const hits = HANDBOOK.filter(
      (entry) => entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle)
    );
    const matches = hits.length > 0 ? hits : HANDBOOK;

    return {
      passages: matches.map((entry) => entry.body),
      // Read back by the Message slot to render the citation cards.
      sources: matches.map(({ title, url, snippet }) => ({ title, url, snippet })),
    };
  }
);

const computeOrbitalPeriod = defineTool(
  'Compute the orbital period for a circular orbit of the given radius around Earth.',
  z.object({ radiusKm: z.number() }),
  ({ radiusKm }) => {
    const mu = 398600.4418; // km^3/s^2
    const seconds = 2 * Math.PI * Math.sqrt(radiusKm ** 3 / mu);

    return {
      radiusKm,
      periodMinutes: Number((seconds / 60).toFixed(2)),
      formula: 'T = 2\\pi\\sqrt{\\frac{r^{3}}{\\mu}}',
      sources: [
        {
          title: 'Orbital mechanics primer',
          url: 'https://example.com/handbook/orbital-mechanics',
          snippet: 'Vis-viva and the circular orbit period.',
        },
      ],
    };
  }
);

const SLOT_NAMES = ['Header', 'Empty state', 'Messages', 'Pending indicator', 'Composer', 'Tool approval', 'Disclaimer'];

const RENDERING_NOTES = [
  'Tool calls as cards, in the turn',
  'LaTeX in assistant prose',
  'Sources pinned under the answer',
  'Reasoning inline, step by step',
];

export default function CustomSlotsDemoPage() {
  useAI({
    tools: { searchHandbook, computeOrbitalPeriod },
    prompt: [
      'The user is viewing the Orbit component slots customization demo.',
      'Use searchHandbook for questions about this library, and computeOrbitalPeriod for orbit questions.',
      'Write mathematics as LaTeX between $ for inline and $$ for display; the UI renders it.',
    ].join('\n'),
    suggestions: FALLBACK_SUGGESTIONS,
  });

  return (
    <div className="custom-slots-demo" data-testid="custom-slots-demo-page">
      <style>{orbitStyles}</style>
      <section className="orbit-page-intro">
        <div>
          <p className="orbit-page-kicker">COMPONENT SLOTS / LIVE EXAMPLE</p>
          <h1>Same engine.<br /><em>A different character.</em></h1>
        </div>
        <div className="orbit-page-note">
          <span>07</span>
          <p>Every visible region below is supplied by the consuming app. Protocol, state, and streaming stay inside use-ai.</p>
        </div>
      </section>

      <section className="orbit-demo-grid">
        <div className="orbit-chat-shell">
          <div className="orbit-chat-accent" />
          <div className="orbit-chat" data-testid="orbit-chat">
            <UseAIChat components={orbitComponents} />
          </div>
        </div>

        <aside className="orbit-specimen-card">
          <p className="orbit-page-kicker">OVERRIDDEN REGIONS</p>
          <h2>Slots, not a theme preset.</h2>
          <p>
            These are regular React components receiving live chat state and callbacks. Change markup, layout, or behavior without forking the chat client.
          </p>
          <ol>
            {SLOT_NAMES.map((name, index) => (
              <li key={name}><span>0{index + 1}</span>{name}</li>
            ))}
          </ol>
          <p className="orbit-page-kicker">BUILT FROM sourceMessages</p>
          <ul className="orbit-notes">
            {RENDERING_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <div className="orbit-code-line">
            <code>{'<UseAIChat components={orbitComponents} />'}</code>
          </div>
        </aside>
      </section>
    </div>
  );
}

const orbitStyles = `
  .custom-slots-demo {
    --orbit-ink: #11182b;
    --orbit-lime: #d7ff3f;
    --orbit-coral: #ff6b57;
    min-height: 100vh;
    padding: 52px clamp(24px, 5vw, 72px) 72px;
    box-sizing: border-box;
    color: var(--orbit-ink);
    background:
      radial-gradient(circle at 90% 4%, rgba(255, 107, 87, .19), transparent 27%),
      linear-gradient(115deg, rgba(17, 24, 43, .045) 1px, transparent 1px),
      #f1f2e9;
    background-size: auto, 34px 34px, auto;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  }
  .orbit-page-intro { display: flex; justify-content: space-between; align-items: end; gap: 40px; max-width: 1180px; margin: 0 auto 42px; }
  .orbit-page-kicker, .orbit-kicker, .orbit-eyebrow { margin: 0; font-size: 10px; line-height: 1.2; font-weight: 800; letter-spacing: .19em; }
  .orbit-page-intro h1 { margin: 13px 0 0; font-size: clamp(38px, 5vw, 68px); line-height: .96; letter-spacing: -.055em; font-weight: 760; }
  .orbit-page-intro h1 em, .orbit-empty h2 em { color: var(--orbit-coral); font-family: Georgia, serif; font-weight: 400; }
  .orbit-page-note { display: flex; align-items: start; gap: 14px; width: min(360px, 100%); padding-bottom: 5px; }
  .orbit-page-note > span { display: grid; place-items: center; flex: 0 0 44px; height: 44px; background: var(--orbit-lime); border: 1px solid var(--orbit-ink); border-radius: 50%; font-size: 13px; font-weight: 800; }
  .orbit-page-note p { margin: 0; font-size: 13px; line-height: 1.55; color: #555b68; }
  .orbit-demo-grid { display: grid; grid-template-columns: minmax(520px, 1fr) 310px; gap: 24px; max-width: 1180px; margin: 0 auto; align-items: stretch; }
  .orbit-chat-shell { display: grid; position: relative; min-height: 680px; overflow: hidden; background: var(--orbit-ink); border-radius: 26px; box-shadow: 0 26px 70px rgba(17, 24, 43, .18); }
  .orbit-chat-accent { position: absolute; top: -55px; right: -42px; width: 190px; height: 190px; border: 34px solid rgba(215, 255, 63, .11); border-radius: 50%; pointer-events: none; z-index: 1; }
  .orbit-chat { min-height: 0; position: relative; z-index: 2; }
  .orbit-chat > div { background: transparent !important; color: #f7f8f0; }
  .orbit-header { min-height: 82px; padding: 18px 22px; box-sizing: border-box; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid rgba(255,255,255,.09); }
  .orbit-brand-mark { position: relative; display: grid; place-items: center; width: 41px; height: 41px; border: 1px solid rgba(255,255,255,.34); border-radius: 50%; }
  .orbit-brand-mark::before { content: ''; position: absolute; inset: 7px -5px; border: 1px solid var(--orbit-lime); border-radius: 50%; transform: rotate(-28deg); }
  .orbit-brand-mark span { width: 7px; height: 7px; background: var(--orbit-lime); border-radius: 50%; box-shadow: 0 0 14px var(--orbit-lime); }
  .orbit-brand-copy { display: flex; flex-direction: column; gap: 2px; }
  .orbit-brand-copy strong { font-family: Georgia, serif; font-size: 22px; font-weight: 400; }
  .orbit-eyebrow { color: #8e96a8; font-size: 8px; }
  .orbit-header-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .orbit-agent-name, .orbit-agent-select { color: #aab0bf; font: inherit; font-size: 11px; background: transparent; border: 0; }
  .orbit-agent-select { max-width: 130px; color: #f7f8f0; outline: none; }
  .orbit-status { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; color: #aab0bf; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
  .orbit-status > span { width: 6px; height: 6px; border-radius: 50%; background: #687083; }
  .orbit-status.is-online > span { background: var(--orbit-lime); box-shadow: 0 0 9px rgba(215,255,63,.75); }
  .orbit-icon-button { width: 32px; height: 32px; border: 0; border-radius: 50%; background: var(--orbit-lime); color: var(--orbit-ink); cursor: pointer; font-size: 20px; line-height: 1; }
  .orbit-icon-button:disabled { opacity: .25; cursor: default; }
  .orbit-empty { display: flex; flex-direction: column; align-items: flex-start; max-width: 550px; width: 100%; margin: auto; padding: 32px 26px 18px; box-sizing: border-box; }
  .orbit-orb { position: relative; width: 67px; height: 67px; margin-bottom: 24px; border-radius: 50%; border: 1px solid rgba(215,255,63,.72); display: grid; place-items: center; }
  .orbit-orb::before { content: ''; position: absolute; width: 89px; height: 30px; border: 1px solid rgba(215,255,63,.35); border-radius: 50%; transform: rotate(-25deg); }
  .orbit-orb div { width: 20px; height: 20px; border-radius: 50%; background: var(--orbit-lime); filter: blur(1px); box-shadow: 0 0 24px rgba(215,255,63,.75); }
  .orbit-kicker { color: var(--orbit-lime); }
  .orbit-empty h2 { margin: 10px 0 10px; color: #f7f8f0; font-size: clamp(32px, 4vw, 47px); line-height: .98; letter-spacing: -.045em; }
  .orbit-intro { max-width: 420px; margin: 0; color: #9fa6b7; font-size: 13px; line-height: 1.55; }
  .orbit-prompts { width: 100%; display: grid; gap: 7px; margin-top: 24px; }
  .orbit-prompts button { display: grid; grid-template-columns: 27px 1fr auto; align-items: center; gap: 7px; width: 100%; padding: 11px 13px; color: #e9ebdf; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.1); border-radius: 9px; text-align: left; cursor: pointer; font: inherit; font-size: 12px; transition: border-color .15s, background .15s, transform .15s; }
  .orbit-prompts button:hover:not(:disabled) { background: rgba(215,255,63,.07); border-color: rgba(215,255,63,.55); transform: translateX(3px); }
  .orbit-prompts button:disabled { opacity: .45; cursor: not-allowed; }
  .orbit-prompts button span { color: #737b8d; font-size: 9px; font-weight: 800; }
  .orbit-prompts button b { color: var(--orbit-lime); font-size: 15px; }
  .orbit-message { display: flex; align-items: flex-start; gap: 10px; width: min(88%, 590px); }
  .orbit-message.is-user { flex-direction: row-reverse; align-self: flex-end; }
  .orbit-message.is-tool { opacity: .75; }
  .orbit-avatar { display: grid; place-items: center; flex: 0 0 30px; height: 30px; border: 1px solid rgba(215,255,63,.5); border-radius: 50%; color: var(--orbit-lime); font: 12px Georgia, serif; }
  .orbit-message.is-user .orbit-avatar { color: var(--orbit-ink); background: var(--orbit-coral); border-color: var(--orbit-coral); font-family: inherit; font-weight: 800; }
  .orbit-message-body { flex: 1; min-width: 0; }
  .orbit-message-meta { display: flex; align-items: center; gap: 8px; margin: 1px 0 5px; color: #747d91; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
  .orbit-message.is-user .orbit-message-meta { justify-content: flex-end; }
  .orbit-message-meta strong { color: #c9ced8; font-size: 10px; }
  .orbit-message-bubble { padding: 11px 13px; color: #e8eae3; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.075); border-radius: 4px 14px 14px 14px; white-space: pre-wrap; font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
  .orbit-message.is-user .orbit-message-bubble { color: var(--orbit-ink); background: var(--orbit-lime); border-color: var(--orbit-lime); border-radius: 14px 4px 14px 14px; }
  .orbit-message-body > * + * { margin-top: 7px; }
  .orbit-reasoning { padding: 8px 11px; background: rgba(255,255,255,.03); border: 1px dashed rgba(255,255,255,.14); border-radius: 10px; }
  .orbit-reasoning summary { color: #8e96a8; font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; cursor: pointer; }
  .orbit-reasoning p { margin: 7px 0 0; color: #9fa6b7; font-size: 11px; line-height: 1.6; white-space: pre-wrap; }
  .orbit-tool-card { padding: 10px 12px; background: rgba(215,255,63,.05); border: 1px solid rgba(215,255,63,.28); border-radius: 11px; }
  .orbit-tool-card.is-pending { border-style: dashed; opacity: .8; }
  .orbit-tool-head { display: flex; align-items: center; gap: 8px; }
  .orbit-tool-glyph { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; color: var(--orbit-ink); background: var(--orbit-lime); font-size: 11px; }
  .orbit-tool-head strong { color: #edf0e5; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .orbit-tool-state { margin-left: auto; color: #8e96a8; font-size: 8px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  .orbit-tool-args { display: grid; gap: 3px; margin: 8px 0 0; }
  .orbit-tool-args > div { display: flex; gap: 8px; font-size: 11px; }
  .orbit-tool-args dt { flex: 0 0 auto; color: #8e96a8; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .orbit-tool-args dd { margin: 0; min-width: 0; color: #d9dce4; overflow-wrap: anywhere; }
  .orbit-math { font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: var(--orbit-lime); white-space: nowrap; }
  .orbit-math.is-block { display: block; margin: 9px 0; padding: 9px 0; text-align: center; font-size: 16px; border-top: 1px solid rgba(255,255,255,.07); border-bottom: 1px solid rgba(255,255,255,.07); }
  .orbit-math sup, .orbit-math sub { font-size: .68em; font-style: normal; }
  .orbit-frac { display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; }
  .orbit-frac > span:first-child { border-bottom: 1px solid currentColor; padding: 0 4px 1px; }
  .orbit-frac > span:last-child { padding: 1px 4px 0; }
  .orbit-sqrt { border-top: 1px solid currentColor; padding: 1px 3px 0; }
  .orbit-sqrt::before { content: '√'; margin-left: -3px; }
  .orbit-citations { padding-top: 4px; }
  .orbit-citations .orbit-kicker { margin-bottom: 6px; color: #747d91; }
  .orbit-citation-row { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 3px; }
  .orbit-citation { display: grid; gap: 3px; flex: 0 0 178px; padding: 9px 10px; color: inherit; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.1); border-radius: 10px; text-decoration: none; transition: border-color .15s, transform .15s; }
  .orbit-citation:hover { border-color: rgba(215,255,63,.5); transform: translateY(-2px); }
  .orbit-citation > span { color: var(--orbit-ink); background: var(--orbit-lime); width: 15px; height: 15px; border-radius: 4px; display: grid; place-items: center; font-size: 8px; font-weight: 800; }
  .orbit-citation strong { color: #e8eae3; font-size: 11px; line-height: 1.3; }
  .orbit-citation small { color: #8e96a8; font-size: 10px; line-height: 1.4; }
  .orbit-citation em { color: #747d91; font-size: 9px; font-style: normal; }
  .orbit-notes { list-style: none; margin: 0 0 18px; padding: 0; display: grid; gap: 6px; }
  .orbit-notes li { position: relative; padding-left: 15px; color: #626775; font-size: 11px; line-height: 1.5; }
  .orbit-notes li::before { content: ''; position: absolute; left: 0; top: 6px; width: 6px; height: 6px; border-radius: 2px; background: var(--orbit-coral); }
  .orbit-avatar-pulse { animation: orbit-pulse 1.6s ease-in-out infinite; }
  .orbit-writing { display: flex; align-items: center; gap: 3px; text-transform: none; letter-spacing: 0; }
  .orbit-writing i { width: 3px; height: 3px; background: var(--orbit-lime); border-radius: 50%; animation: orbit-dot 1s ease-in-out infinite; }
  .orbit-writing i:nth-child(2) { animation-delay: .15s; } .orbit-writing i:nth-child(3) { animation-delay: .3s; margin-right: 3px; }
  .orbit-composer-wrap { padding: 10px 16px 16px; }
  .orbit-composer { padding: 10px 12px 9px; border: 1px solid rgba(255,255,255,.14); border-radius: 15px; background: rgba(255,255,255,.055); box-shadow: 0 10px 35px rgba(0,0,0,.18); }
  .orbit-composer:focus-within { border-color: rgba(215,255,63,.6); }
  .orbit-composer textarea { display: block; width: 100%; min-height: 39px; resize: none; box-sizing: border-box; padding: 2px; color: #f7f8f0; background: transparent; border: 0; outline: 0; font: 13px/1.45 inherit; }
  .orbit-composer textarea::placeholder { color: #747d91; }
  .orbit-composer-actions { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-top: 5px; }
  .orbit-composer-actions > div { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .orbit-composer-actions small { color: #687083; font-size: 8px; }
  .orbit-attach-button { padding: 4px 7px; color: #aab0bf; background: transparent; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; cursor: pointer; font: 600 9px inherit; }
  .orbit-send-button { width: 34px; height: 34px; flex: 0 0 34px; border: 0; border-radius: 50%; color: var(--orbit-ink); background: var(--orbit-lime); cursor: pointer; font-size: 18px; transition: transform .15s; }
  .orbit-send-button:hover:not(:disabled) { transform: translateY(-2px); }
  .orbit-send-button:disabled { opacity: .25; cursor: not-allowed; }
  .orbit-send-button.is-stop { background: var(--orbit-coral); font-size: 11px; }
  .orbit-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 7px; }
  .orbit-attachments button { padding: 5px 8px; color: #e8eae3; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); border-radius: 999px; font: 9px inherit; cursor: pointer; }
  .orbit-file-error { margin: 0 0 6px; color: #ff9182; font-size: 10px; }
  .orbit-disclaimer { margin: 0; padding: 0 18px 14px; color: #687083; font-size: 9px; line-height: 1.4; text-align: center; }
  .orbit-disclaimer span { color: var(--orbit-lime); }
  .orbit-approval { display: flex; align-items: center; gap: 10px; margin: 4px 16px; padding: 11px 12px; color: #f7f8f0; background: rgba(255,107,87,.09); border: 1px solid rgba(255,107,87,.45); border-radius: 11px; }
  .orbit-approval-icon { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 50%; color: var(--orbit-ink); background: var(--orbit-coral); font-weight: 900; }
  .orbit-approval > div { flex: 1; min-width: 0; }
  .orbit-approval p, .orbit-approval strong, .orbit-approval small { display: block; margin: 0; }
  .orbit-approval p { color: #aab0bf; font-size: 9px; text-transform: uppercase; letter-spacing: .1em; }
  .orbit-approval strong { margin-top: 2px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .orbit-approval small { color: #aab0bf; font-size: 9px; }
  .orbit-approval button { padding: 7px 9px; color: #c4c9d3; background: transparent; border: 1px solid rgba(255,255,255,.13); border-radius: 7px; cursor: pointer; font: 600 9px inherit; }
  .orbit-approval button.is-approve { color: var(--orbit-ink); background: var(--orbit-coral); border-color: var(--orbit-coral); }
  .orbit-specimen-card { display: flex; flex-direction: column; min-height: 680px; box-sizing: border-box; padding: 28px 26px; background: #fffdf5; border: 1px solid rgba(17,24,43,.13); border-radius: 26px; }
  .orbit-specimen-card h2 { margin: 16px 0 10px; font-family: Georgia, serif; font-size: 28px; line-height: 1.05; font-weight: 400; letter-spacing: -.025em; }
  .orbit-specimen-card > p:not(.orbit-page-kicker) { margin: 0; color: #626775; font-size: 12px; line-height: 1.6; }
  .orbit-specimen-card ol { list-style: none; margin: 27px 0; padding: 0; border-top: 1px solid #dadbd4; }
  .orbit-specimen-card li { display: flex; gap: 13px; padding: 11px 0; border-bottom: 1px solid #dadbd4; font-size: 12px; font-weight: 700; }
  .orbit-specimen-card li span { color: var(--orbit-coral); font-size: 9px; font-weight: 800; }
  .orbit-code-line { margin-top: auto; padding: 13px; color: #edf0e5; background: var(--orbit-ink); border-radius: 10px; overflow: hidden; }
  .orbit-code-line code { font-size: 9px; white-space: nowrap; }
  @keyframes orbit-pulse { 50% { box-shadow: 0 0 0 6px rgba(215,255,63,.08); } }
  @keyframes orbit-dot { 50% { opacity: .25; transform: translateY(-2px); } }
  @media (max-width: 1050px) {
    .orbit-demo-grid { grid-template-columns: 1fr; }
    .orbit-specimen-card { min-height: auto; }
    .orbit-specimen-card ol { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
    .orbit-code-line { margin-top: 8px; }
  }
  @media (max-width: 720px) {
    .custom-slots-demo { padding: 32px 14px 48px; }
    .orbit-page-intro { display: block; }
    .orbit-page-note { margin-top: 24px; }
    .orbit-demo-grid { display: block; }
    .orbit-chat-shell { min-height: 650px; }
    .orbit-specimen-card { margin-top: 18px; }
    .orbit-composer-actions small { display: none; }
    .orbit-agent-name, .orbit-agent-select { display: none; }
  }
`;
