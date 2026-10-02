// src/websocket/client.ts — one WebSocket per live session.
// Reconnects with backoff while connected; never retries on 4401 (bad station token).

import type { ClientMsg, ServerMsg } from '../protocol';
import { WS_CLOSE_BAD_TOKEN, parseServerMsg } from '../protocol';

export type SocketEvent =
  | { type: 'open' }
  | { type: 'message'; msg: ServerMsg }
  | { type: 'closed'; code: number; willRetry: boolean }
  | { type: 'error'; message: string };

const BACKOFF_S = [1, 2, 4, 8, 16, 30];
const PING_EVERY_MS = 20_000;
const PONG_WITHIN_MS = 10_000;

export class SessionSocket {
  private ws: WebSocket | null = null;
  private cb: ((e: SocketEvent) => void) | null = null;
  private shouldConnect = false;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly url: string) {}

  onEvent(cb: (e: SocketEvent) => void): void {
    this.cb = cb;
  }

  connect(): void {
    this.shouldConnect = true;
    this.dial();
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) ws.close(); // onclose sees a stale socket and stays silent
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.debug('[ws] drop send while not open:', msg.type);
    }
  }

  private emit(e: SocketEvent): void {
    this.cb?.(e);
  }

  private dial(): void {
    if (!this.shouldConnect) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return; // already live
    this.clearRetry();
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempts = 0; // backoff resets on a successful open
      this.startPing();
      this.emit({ type: 'open' });
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws || typeof ev.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return; // malformed frame — ignore
      }
      const msg = parseServerMsg(parsed);
      if (!msg) return; // malformed or unknown frame — ignore
      if (msg.type === 'pong') {
        this.onPong(); // consumed internally; the app never sees pongs
        return;
      }
      this.emit({ type: 'message', msg });
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      this.ws = null;
      this.stopPing();
      if (!this.shouldConnect || ev.code === WS_CLOSE_BAD_TOKEN) {
        // 4401: station token invalid — never retry; app must show registration UI.
        // 4408 (rate-limited) and anything else: retry with backoff.
        this.shouldConnect = false;
        this.emit({ type: 'closed', code: ev.code, willRetry: false });
        return;
      }
      this.emit({ type: 'closed', code: ev.code, willRetry: true });
      this.scheduleRetry();
    };
    ws.onerror = () => {
      if (ws !== this.ws) return;
      this.emit({ type: 'error', message: 'websocket error' });
    };
  }

  private scheduleRetry(): void {
    if (!this.shouldConnect || this.retryTimer) return;
    const backoff = BACKOFF_S[Math.min(this.attempts, BACKOFF_S.length - 1)];
    this.attempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.dial();
    }, backoff * 1000 + Math.random() * 1000); // + jitter
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
      this.clearPong();
      this.pongTimer = setTimeout(() => this.terminate(), PONG_WITHIN_MS);
    }, PING_EVERY_MS);
  }

  private onPong(): void {
    this.clearPong();
  }

  private clearPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPong();
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearRetry();
    this.stopPing();
  }

  private terminate(): void {
    // no pong within 10 s — kill the socket; onclose drives the reconnect
    if (this.ws) this.ws.close();
  }
}
