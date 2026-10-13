import type { AckResponse, ClientToServerEvents, ServerToClientEvents } from '@swcup/shared';
import { io, type Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;
/** serverTime ≈ Date.now() + clockOffset, measured with clock:ping. */
let clockOffset = 0;

export function getSocket(): GameSocket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: false,
    });
    socket.on('connect', () => void syncClock());
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export const serverNow = () => Date.now() + clockOffset;

/** NTP-style offset from a few round trips; the fastest one wins. */
async function syncClock(): Promise<void> {
  let best = { rtt: Number.POSITIVE_INFINITY, offset: 0 };
  for (let i = 0; i < 4; i++) {
    const sent = Date.now();
    try {
      const { serverTs } = await call('clock:ping', { clientTs: sent });
      const received = Date.now();
      const rtt = received - sent;
      if (rtt < best.rtt) best = { rtt, offset: serverTs + rtt / 2 - received };
    } catch {
      return;
    }
  }
  clockOffset = best.offset;
}

export class SocketCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type AckData<E extends keyof ClientToServerEvents> =
  Parameters<Parameters<ClientToServerEvents[E]>[1]>[0] extends AckResponse<infer T> ? T : never;

/** Emits with an acknowledgement and resolves with its data (rejects on errors and timeouts). */
export function call<E extends keyof ClientToServerEvents>(
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
  timeoutMs = 8_000,
): Promise<AckData<E>> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    // biome-ignore lint/suspicious/noExplicitAny: typed at the call signature
    (s.timeout(timeoutMs).emit as any)(event, payload, (err: Error | null, res: AckResponse<AckData<E>>) => {
      if (err) return reject(new SocketCallError('timeout', 'The server did not answer in time'));
      if (res.ok) resolve(res.data);
      else reject(new SocketCallError(res.code, res.message));
    });
  });
}
