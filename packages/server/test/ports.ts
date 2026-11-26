import { createServer } from 'net';

/**
 * Returns a TCP port that the operating system marks as free.
 *
 * UseAIServer does not report the port that it listens on.
 * Thus a test cannot give it port 0 and then connect a client.
 * Use this function instead of a fixed port.
 * A fixed port can collide with a dev server or with a parallel test run.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('Could not read the port of the probe server'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}
