import type { ClientToServerEvents, ServerToClientEvents } from '@swcup/shared';
import type { Server } from 'socket.io';

export interface SocketData {
  userId: string;
}

// biome-ignore lint/complexity/noBannedTypes: Socket.io's generic for inter-server events.
export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export const userRoom = (userId: string) => `user:${userId}`;
export const tournamentRoom = (id: string) => `tournament:${id}`;
export const LEADERBOARD_ROOM = 'leaderboard';

/**
 * Thin wrapper over Socket.io rooms. Every connected socket of a user joins
 * that user's room, so emitting "to a user" reaches all their tabs and works
 * across instances through the Redis adapter.
 */
export class Realtime {
  constructor(private readonly io: GameServer) {}

  toUser(userId: string) {
    return this.io.to(userRoom(userId));
  }

  toRoom(room: string) {
    return this.io.to(room);
  }

  joinRoom(userId: string, room: string): void {
    this.io.in(userRoom(userId)).socketsJoin(room);
  }

  leaveRoom(userId: string, room: string): void {
    this.io.in(userRoom(userId)).socketsLeave(room);
  }

  async isOnline(userId: string): Promise<boolean> {
    const sockets = await this.io.in(userRoom(userId)).fetchSockets();
    return sockets.length > 0;
  }
}
