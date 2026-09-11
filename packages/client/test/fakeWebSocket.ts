/** Enough of a WHATWG WebSocket for partysocket to drive. */
export class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  binaryType = 'blob';
  sent: string[] = [];
  closeCalls = 0;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static get latest(): FakeWebSocket | undefined {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = 3;
  }

  serverOpen(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  serverSend(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  serverClose(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
  }
}

/** The constructor as `WebSocketTransportOptions.WebSocket` expects it. */
export const FakeWebSocketConstructor = FakeWebSocket as unknown as typeof WebSocket;

export async function waitUntil(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
