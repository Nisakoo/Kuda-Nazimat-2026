import { createServer as createPlainServer, type RequestListener, type Server as PlainServer } from 'node:http';
import { createServer as createSecureServer, type Server as SecureServer } from 'node:https';
import { createServer as createListener, type Server as Listener, type Socket } from 'node:net';

export interface Credentials { readonly cert: string; readonly key: string }
export interface Transport {
  /** The listening socket on host:port; `address()` and `close()` refer to it. */
  readonly listener: Listener;
  /** Everything the game serves, including Socket.IO (TLS-007). */
  readonly secure: SecureServer;
  /** Only the trust page, the certificate, health and redirects (TLS-008). */
  readonly plain: PlainServer;
  closeAllConnections(): void;
}

const TLS_HANDSHAKE = 0x16;
/** A connection that sends nothing is dropped; the HTTP servers apply their own request timeouts afterwards. */
const FIRST_BYTE_TIMEOUT_MS = 10_000;

/** TLS-007, 008: one port for both protocols; the first byte tells a TLS ClientHello from plain HTTP. */
export function createTransport(credentials: Credentials, secureHandler: RequestListener, plainHandler: RequestListener, onTlsError: (error: Error, address: string | undefined) => void): Transport {
  const secure = createSecureServer({ ...credentials, minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'], handshakeTimeout: FIRST_BYTE_TIMEOUT_MS }, secureHandler);
  const plain = createPlainServer(plainHandler);
  for (const server of [secure, plain]) { server.requestTimeout = 10000; server.headersTimeout = 10000; }
  const sockets = new Set<Socket>();
  // After a failed handshake the socket is already destroyed and has forgotten its peer; remember it per raw socket.
  const peers = new WeakMap<Socket, string>();
  secure.on('tlsClientError', (error, tlsSocket) => {
    const raw = (tlsSocket as unknown as { _parent?: Socket })._parent;
    onTlsError(error, tlsSocket.remoteAddress ?? (raw && peers.get(raw)));
  });
  const listener = createListener({ pauseOnConnect: true }, (socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    if (socket.remoteAddress) peers.set(socket, socket.remoteAddress);
    // Errors before the hand-off would otherwise crash the process; the HTTP servers report their own.
    socket.on('error', () => {});
    socket.setTimeout(FIRST_BYTE_TIMEOUT_MS, () => socket.destroy());
    socket.once('readable', () => {
      const head = socket.read(1) as Buffer | null;
      if (!head) { socket.destroy(); return; }
      socket.setTimeout(0);
      socket.unshift(head);
      (head[0] === TLS_HANDSHAKE ? secure : plain).emit('connection', socket);
    });
  });
  return {
    listener, secure, plain,
    closeAllConnections() { secure.closeAllConnections(); plain.closeAllConnections(); for (const socket of sockets) socket.destroy(); },
  };
}
