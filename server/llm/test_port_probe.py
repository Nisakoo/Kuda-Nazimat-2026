"""Real loopback sockets only. These tests do not start Ollama or qualify macOS."""
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest import mock

import ollama_worker as worker


@unittest.skipUnless(os.name == 'posix', 'POSIX runtime probe')
class PortProbeTests(unittest.TestCase):
    def test_rejects_live_listener_with_and_without_reuseaddr(self):
        for reuse in (0, 1):
            with self.subTest(reuse=reuse), socket.socket() as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, reuse)
                listener.bind(('127.0.0.1', 0))
                listener.listen(1)
                self.assertFalse(worker.port_free(listener.getsockname()[1]))
                # The probe did not disturb the other listener.
                with socket.create_connection(listener.getsockname(), timeout=1) as client:
                    connection, _ = listener.accept()
                    connection.close()

    def test_reuses_active_close_time_wait_without_a_listener(self):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(('127.0.0.1', 0))
            address = listener.getsockname()
            listener.listen(1)
            with socket.create_connection(address, timeout=1) as client:
                connection, _ = listener.accept()
                with connection:
                    connection.shutdown(socket.SHUT_WR)
                    self.assertEqual(client.recv(1), b'')
                # Client closes second; the server endpoint takes TIME_WAIT.
        if sys.platform.startswith('linux'):
            rows = Path('/proc/net/tcp').read_text().splitlines()[1:]
            self.assertTrue(any(row.split()[1] == f'0100007F:{address[1]:04X}'
                                and row.split()[3] == '06' for row in rows))
        # Regression: the old plain-bind probe returns EADDRINUSE here.
        with socket.socket() as old_probe:
            with self.assertRaises(OSError):
                old_probe.bind(address)
        self.assertTrue(worker.port_free(address[1]))

    @unittest.skipUnless(sys.platform.startswith('linux'), 'Linux bound-only semantics; Darwin needs target validation')
    def test_bound_only_reuse_is_not_proof_of_an_unused_port(self):
        for reuse in (0, 1):
            with self.subTest(reuse=reuse), socket.socket() as bound:
                bound.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, reuse)
                bound.bind(('127.0.0.1', 0))
                self.assertEqual(worker.port_free(bound.getsockname()[1]), bool(reuse))
                # Ownership checks after spawn remain mandatory. The probe
                # neither reserves the port nor claims a bound-only exclusion.

    def test_socket_errors_fail_closed_and_reuseport_is_never_enabled(self):
        for operation in ('create', 'option', 'bind'):
            with self.subTest(operation=operation), mock.patch.object(worker.socket, 'socket') as create:
                sock = create.return_value.__enter__.return_value
                if operation == 'create':
                    create.side_effect = OSError('private error')
                elif operation == 'option':
                    sock.setsockopt.side_effect = OSError('private error')
                else:
                    sock.bind.side_effect = OSError('private error')
                self.assertFalse(worker.port_free(11501))
                if operation != 'create':
                    sock.setsockopt.assert_called_once_with(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)


if __name__ == '__main__':
    unittest.main()
