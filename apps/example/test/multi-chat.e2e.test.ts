import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Multi-chat walkthrough, recorded as a video with a visible cursor and on-screen captions.
 *
 * Runs on the File Transformers page, whose PDF transformer takes about 4 seconds. Chat A gets a
 * long answer; the user opens chat B while it runs, sends there once A is done, then sends a
 * follow-up with a PDF in chat A and switches to chat B while the PDF is processed. Each chat must
 * keep only its own messages, in the UI and in storage.
 *
 * Every check runs to the end of the walkthrough, even after one fails, and is shown on screen;
 * the test fails at the end if any check failed. So a run against code without the chat fixes
 * still records the whole walkthrough and shows where it goes wrong.
 *
 * Run it with scripts/record-multi-chat.sh, which records the video and copies it out.
 * MULTI_CHAT_LABEL: caption title, e.g. which build is under test.
 * MULTI_CHAT_CHECKS_FILE: where to write the check results as JSON.
 * MULTI_CHAT_CANNED_REPLIES=1 is for a server running the mock agent (whose replies are fixed):
 * it skips the checks on the reply text and asks for the mock's slow answer.
 */

const cannedReplies = !!process.env.MULTI_CHAT_CANNED_REPLIES;
const label = process.env.MULTI_CHAT_LABEL || 'Multi-chat walkthrough';

// Long answers keep each run in flight for several seconds, so the chat switches land mid-run.
// The mock agent answers slowly only when asked for "long reasoning".
const mockSuffix = cannedReplies ? ' Use long reasoning.' : '';
const PROMPT_A = `Count from 1 to 300, one number per line. After the last number, write the single word ALPHA.${mockSuffix}`;
const PROMPT_B = `Reply with the single word BRAVO and nothing else.${mockSuffix}`;
const PROMPT_A_FOLLOW_UP =
  `Which word did you write at the end of your previous answer in this chat? Reply with that word only.${mockSuffix}`;

test.use({
  viewport: { width: 1280, height: 720 },
  video: { mode: 'on', size: { width: 1280, height: 720 } },
  // BROWSER_EXECUTABLE runs another headless shell build when the one Playwright expects is missing.
  // Google Chrome (channel: 'chrome') is not an option here: on macOS its video loses the bottom 88px.
  ...(process.env.BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.BROWSER_EXECUTABLE } } : {}),
});

/**
 * Draws a dot that follows the mouse and a ripple on each click (Playwright videos show no
 * cursor), and a caption box over the sidebar.
 */
async function installOverlay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const install = () => {
      const style = document.createElement('style');
      style.textContent = `
        #e2e-cursor { position: fixed; left: 0; top: 0; width: 18px; height: 18px; margin: -9px 0 0 -9px;
          border-radius: 50%; background: rgba(255, 64, 64, 0.85); border: 2px solid white;
          box-shadow: 0 0 6px rgba(0, 0, 0, 0.5); pointer-events: none; z-index: 2147483647; }
        .e2e-ripple { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
          border: 3px solid rgba(255, 64, 64, 0.9); pointer-events: none; z-index: 2147483646;
          animation: e2e-ripple 0.6s ease-out forwards; }
        @keyframes e2e-ripple { from { transform: scale(0.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
        #e2e-caption { position: fixed; left: 12px; top: 12px; width: 236px; padding: 10px 12px;
          border-radius: 8px; background: rgba(17, 24, 39, 0.94); color: white; pointer-events: none;
          z-index: 2147483645; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); }
        #e2e-caption:empty { display: none; }
        #e2e-caption .title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
        #e2e-caption .scene { margin-bottom: 6px; }
        #e2e-caption .note { color: #fcd34d; margin-bottom: 6px; }
        #e2e-caption .pass { color: #86efac; }
        #e2e-caption .fail { color: #fca5a5; font-weight: 700; }
      `;
      document.head.appendChild(style);
      const cursor = document.createElement('div');
      cursor.id = 'e2e-cursor';
      document.body.appendChild(cursor);
      const caption = document.createElement('div');
      caption.id = 'e2e-caption';
      document.body.appendChild(caption);
      document.addEventListener('mousemove', (e) => {
        cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      }, true);
      document.addEventListener('mousedown', (e) => {
        const ripple = document.createElement('div');
        ripple.className = 'e2e-ripple';
        ripple.style.left = `${e.clientX}px`;
        ripple.style.top = `${e.clientY}px`;
        document.body.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);
      }, true);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else {
      install();
    }
  });
}

interface CheckResult {
  name: string;
  passed: boolean;
  error?: string;
}

/** The caption's content: the scene being played and the results of its checks. */
class Captions {
  private scene = '';
  private note = '';
  private sceneResults: CheckResult[] = [];
  readonly results: CheckResult[] = [];

  constructor(private readonly page: Page) {}

  async startScene(scene: string, note = ''): Promise<void> {
    this.scene = scene;
    this.note = note;
    this.sceneResults = [];
    await this.render();
  }

  /** Runs a check without stopping the walkthrough when it fails; the failure is shown and kept. */
  async check(name: string, body: () => Promise<void>): Promise<void> {
    let result: CheckResult;
    try {
      await body();
      result = { name, passed: true };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, '');
      result = { name, passed: false, error: message.split('\n').filter(Boolean).slice(0, 4).join(' | ') };
      console.log(`CHECK FAILED: ${name}: ${result.error}`);
    }
    this.results.push(result);
    this.sceneResults.push(result);
    await this.render();
    await this.page.waitForTimeout(result.passed ? 600 : 2500);
  }

  async summary(): Promise<void> {
    const failed = this.results.filter((r) => !r.passed);
    this.scene = failed.length === 0
      ? `All ${this.results.length} checks passed.`
      : `${failed.length} of ${this.results.length} checks failed.`;
    this.note = '';
    this.sceneResults = failed;
    await this.render();
  }

  private async render(): Promise<void> {
    const lines = [
      { cls: 'title', text: label },
      { cls: 'scene', text: this.scene },
      ...(this.note ? [{ cls: 'note', text: this.note }] : []),
      ...this.sceneResults.map((r) => ({ cls: r.passed ? 'pass' : 'fail', text: `${r.passed ? 'PASS' : 'FAIL'}: ${r.name}` })),
    ];
    await this.page.evaluate((items) => {
      const caption = document.getElementById('e2e-caption');
      if (!caption) return;
      caption.replaceChildren(...items.map(({ cls, text }) => {
        const div = document.createElement('div');
        div.className = cls;
        div.textContent = text;
        return div;
      }));
    }, lines);
  }
}

/** Moves the mouse to the middle of the element in visible steps, then clicks it. */
async function clickVisibly(page: Page, locator: Locator): Promise<void> {
  // page.mouse.click does not wait for actionability the way locator.click does.
  await expect(locator).toBeEnabled({ timeout: 30000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No bounding box for ${locator}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
}

async function type(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await clickVisibly(page, input);
  await input.pressSequentially(text, { delay: 15 });
}

async function send(page: Page): Promise<void> {
  const button = page.getByTestId('chat-send-button');
  await expect(button).toBeEnabled({ timeout: 60000 });
  await clickVisibly(page, button);
}

async function attachFile(page: Page, file: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await clickVisibly(page, page.getByTestId('file-picker-button'));
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('file-chip')).toBeVisible({ timeout: 5000 });
}

async function openChat(page: Page, title: string): Promise<void> {
  await clickVisibly(page, page.getByTestId('chat-history-dropdown-button'));
  const item = page.getByTestId('chat-history-item').filter({ hasText: title });
  await expect(item).toHaveCount(1);
  await clickVisibly(page, item);
}

/**
 * A run is in flight while the stop button replaces the send button. The streaming answer is no
 * signal: a provider that delivers the answer in one burst shows it for less than a frame.
 */
async function expectRunInFlight(page: Page, message: string): Promise<void> {
  await expect(page.getByTestId('chat-stop-button'), message).toBeVisible({ timeout: 10000 });
}

/** No run is in flight once the send button is back (the stop button replaces it during a run). */
async function waitForIdle(page: Page): Promise<void> {
  await expect(page.getByTestId('chat-send-button')).toBeVisible({ timeout: 90000 });
  await expect(page.getByTestId('chat-message-assistant-streaming')).toHaveCount(0, { timeout: 90000 });
}

/** Polls for up to 5 seconds until the displayed chat holds exactly these user messages and reply count. */
async function expectDisplayed(page: Page, userTexts: string[], assistantCount: number): Promise<void> {
  const expected = JSON.stringify({ users: userTexts.map((t) => t.slice(0, 40)), replies: assistantCount });
  let actual = '';
  for (const deadline = Date.now() + 5000; Date.now() < deadline; await page.waitForTimeout(250)) {
    const users = await page.getByTestId('chat-message-user').allTextContents();
    const replies = await page.getByTestId('chat-message-assistant').count();
    actual = JSON.stringify({ users: users.map((t) => t.slice(0, 40)), replies });
    if (actual === expected) return;
  }
  throw new Error(`displayed ${actual}, expected ${expected}`);
}

/**
 * While a run is in flight, the displayed chat shows neither the pending bubble nor the
 * "Thinking..." placeholder. Sampled once, together with the stop button that proves the run is
 * still in flight; fails as inconclusive when it is not.
 */
async function expectNoPendingRun(page: Page): Promise<void> {
  if (!(await page.getByTestId('chat-stop-button').isVisible())) {
    throw new Error('inconclusive: no run in flight to check against');
  }
  const placeholder = await page.getByTestId('chat-input').getAttribute('placeholder');
  if (placeholder?.includes('Thinking')) throw new Error(`placeholder is "${placeholder}"`);
  const bubbles = await page.locator('.dots').count();
  if (bubbles > 0) throw new Error(`${bubbles} pending bubble(s) visible`);
}

/** Text of the pending indicator while a send-time file transformation runs. */
const PROCESSING_FILE = 'Processing file...';
/** How long the File Transformers page's PDF transformer runs. */
const PDF_PROCESSING_MS = 4000;

/**
 * Samples for 1.5 seconds that the locator stays hidden. Fails as inconclusive when the sampling
 * would start after `windowMs` from `since`: the thing it must not show is over by then.
 */
async function expectNeverVisible(page: Page, locator: Locator, since: number, windowMs: number): Promise<void> {
  const remaining = since + windowMs - Date.now();
  if (remaining < 1000) {
    throw new Error(`inconclusive: only ${remaining}ms of the ${windowMs}ms window left to sample`);
  }
  for (const deadline = Date.now() + Math.min(1500, remaining); Date.now() < deadline; await page.waitForTimeout(100)) {
    if (await locator.isVisible()) throw new Error(`${locator} is visible`);
  }
}

async function expectLastReply(page: Page, word: string, notWord?: string): Promise<void> {
  const last = page.getByTestId('chat-message-assistant').last();
  await expect(last).toContainText(word, { timeout: 5000 });
  if (notWord) await expect(last).not.toContainText(notWord);
}

interface StoredChat {
  id: string;
  messages: Array<{ role: string; content: unknown }>;
}

async function storedChats(page: Page): Promise<StoredChat[]> {
  return page.evaluate(() => {
    const ids = JSON.parse(localStorage.getItem('use-ai:chat-index') || '[]') as string[];
    return ids
      .map((id) => localStorage.getItem(`use-ai:chat:${id}`))
      .filter((raw): raw is string => !!raw)
      .map((raw) => JSON.parse(raw) as StoredChat);
  });
}

function storedChatWith(chats: StoredChat[], prompt: string): StoredChat {
  const found = chats.filter((c) => JSON.stringify(c.messages).includes(prompt.slice(0, 40)));
  expect(found, `exactly one stored chat holds "${prompt}"`).toHaveLength(1);
  return found[0];
}

test.describe('Multi-chat', () => {
  test.setTimeout(300000);

  test('each send and reply stays on the chat it started in', async ({ page }) => {
    const pdf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'multi-chat-')), 'quarterly-report.pdf');
    fs.writeFileSync(pdf, '%PDF-1.4\nQuarterly report.');

    await installOverlay(page);
    const captions = new Captions(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.mouse.move(640, 360);
    await captions.startScene('Open the File Transformers page: its PDF transformer takes about 4 seconds.');
    await clickVisibly(page, page.getByRole('button', { name: 'File Transformers' }));
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    await captions.startScene(
      '1. Chat A asks for a long answer. Open a new chat B while it runs.',
      'Sending stays blocked in every chat while A runs (not part of the chat fixes).'
    );
    await type(page, PROMPT_A);
    await send(page);
    await expectRunInFlight(page, 'chat A run started');
    await clickVisibly(page, page.getByTestId('new-chat-button'));
    await expectRunInFlight(page, 'chat A run still in flight after opening chat B');
    await captions.check('chat B is empty while chat A runs', () => expectDisplayed(page, [], 0));
    await captions.check('chat B shows no pending bubble or "Thinking..." while chat A runs', () =>
      expectNoPendingRun(page));

    await captions.startScene('2. Chat A finishes off screen.');
    await waitForIdle(page);
    await page.waitForTimeout(1000);
    await captions.check('chat B is still empty', () => expectDisplayed(page, [], 0));

    await captions.startScene('3. Chat B asks its own question.');
    await type(page, PROMPT_B);
    await send(page);
    await waitForIdle(page);
    await captions.check('chat B shows its own question and one reply', () => expectDisplayed(page, [PROMPT_B], 1));
    if (!cannedReplies) {
      await captions.check('chat B reply is BRAVO', () => expectLastReply(page, 'BRAVO', 'ALPHA'));
    }

    await captions.startScene('4. Back to chat A.');
    await openChat(page, PROMPT_A.slice(0, 20));
    await captions.check('chat A shows its own question and one reply', () => expectDisplayed(page, [PROMPT_A], 1));
    if (!cannedReplies) {
      await captions.check('chat A reply ends with ALPHA', () => expectLastReply(page, 'ALPHA'));
    }

    await captions.startScene('5. Chat A sends a follow-up with a PDF. Switch to chat B while the PDF is processed.');
    await type(page, PROMPT_A_FOLLOW_UP);
    // Attached last, so the send itself waits for the transformer.
    await attachFile(page, pdf);
    await send(page);
    const sentAt = Date.now();
    await expectRunInFlight(page, 'chat A follow-up started');
    await expect(page.getByText(PROCESSING_FILE), 'file processing indicator in chat A').toBeVisible({ timeout: 3000 });
    await openChat(page, PROMPT_B.slice(0, 20));
    await captions.check("chat B shows no file processing indicator while chat A's PDF is processed", () =>
      expectNeverVisible(page, page.getByText(PROCESSING_FILE), sentAt, PDF_PROCESSING_MS));
    await captions.check('chat A follow-up still in flight at the switch', () =>
      expect(page.getByTestId('chat-stop-button')).toBeVisible({ timeout: 1000 }));
    // Checked once the run is over: without the fixes, chat A's follow-up shows up in chat B when
    // the send goes out after the PDF is processed, not at the switch.
    await waitForIdle(page);
    await page.waitForTimeout(1000);
    await captions.check("chat B does not show chat A's follow-up", () => expectDisplayed(page, [PROMPT_B], 1));

    await captions.startScene('6. Back to chat A.');
    await openChat(page, PROMPT_A.slice(0, 20));
    await captions.check('chat A shows both its questions and two replies', () =>
      expectDisplayed(page, [PROMPT_A, PROMPT_A_FOLLOW_UP], 2));
    if (!cannedReplies) {
      // The follow-up only knows ALPHA if it ran with chat A's history.
      await captions.check("the follow-up reply knows chat A's history (ALPHA)", () => expectLastReply(page, 'ALPHA'));
    }

    await captions.startScene('7. Storage: each chat holds only its own turns.');
    const chats = await storedChats(page);
    await captions.check('stored chat A: its two questions and two replies', async () => {
      const chatA = storedChatWith(chats, PROMPT_A);
      expect(chatA.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(JSON.stringify(chatA.messages)).not.toContain(PROMPT_B.slice(0, 40));
    });
    await captions.check('stored chat B: its question and reply only', async () => {
      const chatB = storedChatWith(chats, PROMPT_B);
      expect(chatB.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(JSON.stringify(chatB.messages)).not.toContain(PROMPT_A.slice(0, 40));
    });

    await captions.summary();
    await page.waitForTimeout(3000);
    if (process.env.MULTI_CHAT_CHECKS_FILE) {
      fs.writeFileSync(process.env.MULTI_CHAT_CHECKS_FILE, JSON.stringify(captions.results, null, 2));
    }
    expect(captions.results.filter((r) => !r.passed), 'failed checks').toEqual([]);
  });
});
