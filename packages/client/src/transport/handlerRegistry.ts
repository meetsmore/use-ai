import type { UseAITransportEventName } from './types';

type Handler = (data: unknown) => void;

/**
 * The subscribe/dispatch bookkeeping shared by the bundled transports.
 * A name with no subscribers dispatches to nobody, which is what makes an
 * unrecognised downstream frame a no-op rather than an error.
 */
export class TransportHandlerRegistry {
  private handlers: Map<string, Set<Handler>> = new Map();

  on(name: UseAITransportEventName, handler: Handler): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  dispatch(name: string, data: unknown): void {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const handler of [...set]) {
      handler(data);
    }
  }
}
