import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Multi-chat walkthrough, recorded as a video with a visible cursor.
 *
 * Chat A gets a long answer; the user opens chat B while it streams, sends there once A is done,
 * then switches back and forth while a second run streams. Each chat must keep only its own
 * messages, in the UI and in storage.
 *
 * Run it with scripts/record-multi-chat.sh, which records the video and copies it out.
 * MULTI_CHAT_CANNED_REPLIES=1 is for a server running the mock agent (whose replies are fixed):
 * it skips the checks on the reply text and asks for the mock's slow answer.
 */

const cannedReplies = !!process.env.MULTI_CHAT_CANNED_REPLIES;

// Long answers keep each run in flight for several seconds, so the chat switches land mid-run.
// The mock agent answers slowly only when asked for "long reasoning".
const mockSuffix = cannedReplies ? ' Use long reasoning.' : '';
const PROMPT_A = `Count from 1 to 300, one number per line. After the last number, write the single word ALPHA.${mockSuffix}`;
const PROMPT_B = `Reply with the single word BRAVO and nothing else.${mockSuffix}`;
const PROMPT_A_FOLLOW_UP =
  `Which word did you write at the end of your previous answer? Then count from 1 to 300, one number per line.${mockSuffix}`;

test.use({
  viewport: { width: 1280, height: 720 },
  video: { mode: 'on', size: { width: 1280, height: 720 } },
  // BROWSER_EXECUTABLE runs another headless shell build when the one Playwright expects is missing.
  // Google Chrome (channel: 'chrome') is not an option here: on macOS its video loses the bottom 88px.
  ...(process.env.BROWSER_EXECUTABLE ? { launchOptions: { executablePath: process.env.BROWSER_EXECUTABLE } } : {}),
});

/** Draws a dot that follows the mouse and a ripple on each click: Playwright videos show no cursor. */
async function installCursorOverlay(page: Page): Promise<void> {
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
      `;
      document.head.appendChild(style);
      const cursor = document.createElement('div');
      cursor.id = 'e2e-cursor';
      document.body.appendChild(cursor);
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

async function typeAndSend(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('chat-input');
  await clickVisibly(page, input);
  await input.pressSequentially(text, { delay: 15 });
  const send = page.getByTestId('chat-send-button');
  await expect(send).toBeEnabled({ timeout: 60000 });
  await clickVisibly(page, send);
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

async function expectDisplayed(page: Page, userTexts: string[], assistantCount: number): Promise<void> {
  const users = page.getByTestId('chat-message-user');
  await expect(users).toHaveCount(userTexts.length, { timeout: 30000 });
  for (const [i, text] of userTexts.entries()) {
    await expect(users.nth(i)).toContainText(text.slice(0, 40));
  }
  await expect(page.getByTestId('chat-message-assistant')).toHaveCount(assistantCount, { timeout: 30000 });
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
  test.setTimeout(240000);

  test('each send and reply stays on the chat it started in', async ({ page }) => {
    await installCursorOverlay(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.mouse.move(640, 360);

    await clickVisibly(page, page.getByText('Todo List').first());
    await expect(page.locator('h1:has-text("Todo List")')).toBeVisible();
    await clickVisibly(page, page.getByTestId('ai-button'));
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 10000 });

    await test.step('chat A: send, then open chat B while the answer streams', async () => {
      await typeAndSend(page, PROMPT_A);
      await expectRunInFlight(page, 'chat A run started');
      await clickVisibly(page, page.getByTestId('new-chat-button'));
      await expectRunInFlight(page, 'chat A run still in flight after opening chat B');
      await expectDisplayed(page, [], 0);
      await expect(page.getByTestId('chat-message-assistant-streaming')).toHaveCount(0);
    });

    await test.step('chat A finishes off screen; chat B stays empty', async () => {
      await waitForIdle(page);
      await page.waitForTimeout(1000);
      await expectDisplayed(page, [], 0);
    });

    await test.step('chat B: send and get its own reply', async () => {
      await typeAndSend(page, PROMPT_B);
      await waitForIdle(page);
      await expectDisplayed(page, [PROMPT_B], 1);
      if (!cannedReplies) {
        await expect(page.getByTestId('chat-message-assistant').last()).toContainText('BRAVO');
        await expect(page.getByTestId('chat-message-assistant').last()).not.toContainText('ALPHA');
      }
    });

    await test.step('back to chat A: its own message and answer', async () => {
      await openChat(page, PROMPT_A.slice(0, 20));
      await expectDisplayed(page, [PROMPT_A], 1);
      if (!cannedReplies) {
        await expect(page.getByTestId('chat-message-assistant').last()).toContainText('ALPHA');
      }
    });

    await test.step('chat A: follow-up, switch to chat B mid-run and back', async () => {
      await typeAndSend(page, PROMPT_A_FOLLOW_UP);
      await expectRunInFlight(page, 'chat A follow-up run started');
      await openChat(page, PROMPT_B.slice(0, 20));
      await expectRunInFlight(page, 'chat A follow-up still in flight after opening chat B');
      await expectDisplayed(page, [PROMPT_B], 1);
      await expect(page.getByTestId('chat-message-assistant-streaming')).toHaveCount(0);
      await waitForIdle(page);
      await expectDisplayed(page, [PROMPT_B], 1);

      await openChat(page, PROMPT_A.slice(0, 20));
      await expectDisplayed(page, [PROMPT_A, PROMPT_A_FOLLOW_UP], 2);
      if (!cannedReplies) {
        // The follow-up only knows ALPHA if chat A's history went with it.
        await expect(page.getByTestId('chat-message-assistant').last()).toContainText('ALPHA');
      }
    });

    await test.step('storage: each chat holds only its own turns', async () => {
      const chats = await storedChats(page);
      const chatA = storedChatWith(chats, PROMPT_A);
      const chatB = storedChatWith(chats, PROMPT_B);
      expect(chatA.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(chatB.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
      expect(JSON.stringify(chatB.messages)).not.toContain(PROMPT_A.slice(0, 40));
      expect(JSON.stringify(chatA.messages)).not.toContain(PROMPT_B.slice(0, 40));
    });

    await page.waitForTimeout(1500);
  });
});
