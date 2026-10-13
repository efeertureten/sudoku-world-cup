import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueue, useToasts, useTournament } from '../stores/lobby';
import { useMatch } from '../stores/match';
import { useSession } from '../stores/session';
import { disconnectSocket, getSocket } from './socket';

/**
 * Connects the socket once a session exists and routes server events into
 * the stores. Navigation follows the server: a found or resumed match always
 * takes the player to the board.
 */
export function useSocketBridge(): void {
  const status = useSession((s) => s.status);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (status !== 'ready') return;
    const socket = getSocket();
    const session = useSession.getState();
    const match = useMatch.getState;
    const goToMatch = () => {
      if (window.location.pathname !== '/match') navigate('/match');
    };

    socket.on('connect', () => session.setConnected(true));
    socket.on('disconnect', () => session.setConnected(false));
    socket.on('connect_error', (err) => {
      session.setConnected(false);
      if (err.message === 'unauthorized') void session.bootstrap();
    });
    socket.on('queue:status', (p) => useQueue.getState().onStatus(p));
    socket.on('match:found', (p) => {
      useQueue.getState().clear();
      match().onFound(p);
      goToMatch();
    });
    socket.on('match:countdown', (p) => match().onCountdown(p));
    socket.on('match:start', (p) => match().onStart(p));
    socket.on('match:resume', (p) => {
      useQueue.getState().clear();
      match().onResume(p);
      goToMatch();
    });
    socket.on('match:opponent_progress', (p) => match().onOpponentProgress(p));
    socket.on('match:opponent_connection', (p) => match().onOpponentConnection(p));
    socket.on('match:emote', (p) => match().onEmote(p.emoteId, false));
    socket.on('match:end', (p) => {
      match().onEnd(p);
      void useSession.getState().refreshMe();
    });
    socket.on('tournament:state', (p) => useTournament.getState().set(p));
    socket.on('notice', (p) => useToasts.getState().push(p.message));

    socket.connect();
    return () => {
      socket.removeAllListeners();
      disconnectSocket();
    };
  }, [status, navigate]);

  // Leaving the board while nothing is live returns the match store to idle.
  useEffect(() => {
    const { phase, reset } = useMatch.getState();
    if (location.pathname !== '/match' && phase === 'ended') reset();
  }, [location.pathname]);
}
