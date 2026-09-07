"""Exercise the verifier against subprocesses, without installed language servers."""

import fcntl
import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch


def fake_server(mode):
    if mode == "nix-ready":
        Path("server-started").touch()
        assert (Path(os.environ["NIX_REMOTE"]) / "initialized").read_text() == "ready"

    def receive():
        headers = {}
        while (line := sys.stdin.buffer.readline()) != b"\r\n":
            if not line:
                raise EOFError("client closed stdin")
            key, value = line.decode().split(":", 1)
            headers[key.lower()] = value.strip()
        return json.loads(sys.stdin.buffer.read(int(headers["content-length"])))

    def send(message):
        body = json.dumps({"jsonrpc": "2.0", **message}, ensure_ascii=False).encode()
        frame = (
            f"Content-Length: {len(body)}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n".encode()
            + body
        )
        # Fragment both headers and multibyte UTF-8 bodies.
        for offset in range(0, len(frame), 7):
            os.write(1, frame[offset : offset + 7])

    init = receive()
    assert init["method"] == "initialize"
    assert Path(os.environ["HOME"]).is_relative_to(Path.cwd())
    assert Path(os.environ["NIX_REMOTE"]).is_relative_to(Path.cwd())
    if mode == "eof":
        sys.stderr.write("fixture startup failure\n")
        return
    if mode == "malformed":
        os.write(1, b"Content-Length: nope\r\n\r\n")
        return
    if mode == "partial":
        os.write(1, b"Content-Length: 100\r\n\r\n{")
        time.sleep(30)
    if mode == "error":
        send(
            {
                "id": init["id"],
                "error": {"code": -32603, "message": "fixture RPC failure"},
            }
        )
        time.sleep(30)
    if mode == "flood":
        while True:
            send(
                {
                    "method": "window/logMessage",
                    "params": {"type": 3, "message": "still working"},
                }
            )
    if mode == "bad-init":
        send({"id": init["id"], "result": {}})
        time.sleep(30)
    send({"id": init["id"], "result": {"capabilities": {"textDocumentSync": 1}}})
    assert receive()["method"] == "initialized"
    opened = receive()
    assert opened["method"] == "textDocument/didOpen"
    document = opened["params"]["textDocument"]
    if mode == "nix-ready":
        assert document["languageId"] == "nix"
        assert document["text"] == "let value = ; in value\n"
    else:
        assert document["languageId"] == "json"
        assert document["text"] == '{"value": }\n'
    send(
        {
            "id": "config",
            "method": "workspace/configuration",
            "params": {"items": [{"section": "json"}, {"section": "unknown"}]},
        }
    )
    assert receive()["result"] == [{}, {}]
    send(
        {
            "id": "register",
            "method": "client/registerCapability",
            "params": {"registrations": []},
        }
    )
    assert receive()["result"] is None
    send({"id": "unknown", "method": "fixture/unknown", "params": {}})
    assert receive()["error"]["code"] == -32601
    os.write(2, b"x" * 100000 + b"fixture stderr tail\n")
    diagnostic = {
        "severity": 1,
        "message": "Expected value: \u00e9",
        "range": {
            "start": {"line": 0, "character": 10},
            "end": {"line": 0, "character": 11},
        },
    }
    send(
        {
            "method": "textDocument/publishDiagnostics",
            "params": {"uri": document["uri"], "diagnostics": []},
        }
    )
    send(
        {
            "method": "textDocument/publishDiagnostics",
            "params": {"uri": "file:///unrelated.json", "diagnostics": [diagnostic]},
        }
    )
    if mode != "wrong-uri":
        send(
            {
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": document["uri"],
                    "version": 1,
                    "diagnostics": [diagnostic],
                },
            }
        )
    if mode == "wrong-uri":
        time.sleep(30)
    shutdown = receive()
    assert shutdown["method"] == "shutdown"
    send({"id": shutdown["id"], "result": None})
    assert receive()["method"] == "exit"
    if mode in ("noisy-exit", "noisy-bad-exit", "exit-flood"):
        while True:
            for _ in range(16):
                os.write(1, b"o" * 65536)
                os.write(2, b"e" * 65536)
            if mode != "exit-flood":
                break
        os.write(2, b"final shutdown stderr\n")
        if mode == "noisy-bad-exit":
            sys.exit(7)
    if mode == "closed-pipes-exit":
        os.close(1)
        os.close(2)
        time.sleep(30)
    if mode == "hang-exit":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        time.sleep(30)
    if mode == "bad-exit":
        sys.exit(7)


class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).with_name("lsp-functional.py")
        if not path.exists():
            raise AssertionError("LSP functional verifier is not implemented")
        spec = importlib.util.spec_from_file_location("lsp_functional", path)
        assert spec is not None and spec.loader is not None
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def run_server(self, mode, timeout=2.0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = [sys.executable, str(Path(__file__).resolve()), "--server", mode]
            return self.module.verify("json-ls", {"command": command}, root, timeout)

    def test_fragmented_frames_requests_notifications_and_clean_exit(self):
        self.run_server("ok")

    def test_nix_store_initialized_once_before_launch_and_setup_failures_stop_launch(
        self,
    ):
        for mode in ("ok", "fail", "timeout"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve()
                bin_dir = root / "bin"
                bin_dir.mkdir()
                initializer = bin_dir / "nix-store"
                initializer.write_text(
                    f"#!{sys.executable}\n"
                    "import os, sys, time\n"
                    "from pathlib import Path\n"
                    "assert sys.argv[1:] == ['--init']\n"
                    f"mode = {mode!r}\n"
                    "if mode == 'fail': sys.exit(12)\n"
                    "if mode == 'timeout': time.sleep(30)\n"
                    "with (Path(os.environ['NIX_REMOTE']) / 'initialized').open('x') as f:\n"
                    "    f.write('ready')\n"
                )
                initializer.chmod(0o700)
                command = [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "--server",
                    "nix-ready",
                ]
                with patch.dict(
                    os.environ,
                    {"PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", "")},
                ):
                    if mode == "ok":
                        self.module.verify("nixd", {"command": command}, root, 1)
                    else:
                        error = (
                            subprocess.CalledProcessError
                            if mode == "fail"
                            else subprocess.TimeoutExpired
                        )
                        with self.assertRaises(error):
                            self.module.verify("nixd", {"command": command}, root, 0.5)
                        self.assertFalse((root / "server-started").exists())

    def test_exit_drains_more_than_pipe_capacity_on_both_streams(self):
        self.run_server("noisy-exit")

    def test_failed_exit_preserves_final_stderr_with_bounded_output(self):
        with self.assertRaisesRegex(RuntimeError, "status 7") as raised:
            self.run_server("noisy-bad-exit")
        self.assertIn("final shutdown stderr", str(raised.exception))
        self.assertLess(len(str(raised.exception)), 17000)

    def test_exited_parent_with_inherited_pipes_cleans_descendant_and_drains_stderr(
        self,
    ):
        for status in (0, 7):
            with (
                self.subTest(status=status),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                script = """
import fcntl, os, signal, sys, time
lock = open('lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX)
if os.fork() == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(30)
    os._exit(0)
for _ in range(16):
    os.write(1, b'o' * 65536)
    os.write(2, b'e' * 65536)
os.write(2, b'final parent stderr\\n')
os._exit(int(sys.argv[1]))
"""
                with self.module.Client(
                    [sys.executable, "-c", script, str(status)],
                    root,
                    os.environ.copy(),
                    1,
                ) as client:
                    self.assertEqual(client.wait_for_exit(), status)
                    self.assertTrue(client.stderr.endswith(b"final parent stderr\n"))
                    self.assertLessEqual(len(client.stderr), 16384)
                    self.assertEqual(client.buffer, b"")
                    # Check before __exit__: the exit waiter must clean descendants.
                    with (root / "lock").open() as lock:
                        deadline = time.monotonic() + 1
                        while True:
                            try:
                                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                                break
                            except BlockingIOError:
                                if time.monotonic() >= deadline:
                                    self.fail(
                                        "descendant still holds lock after parent exit"
                                    )
                                time.sleep(0.01)

    def test_errors_never_report_success(self):
        for mode, expected in [
            ("error", "fixture RPC failure"),
            ("eof", "fixture startup failure"),
            ("malformed", "Content-Length"),
            ("bad-init", "capabilities"),
            ("bad-exit", "7"),
        ]:
            with (
                self.subTest(mode=mode),
                self.assertRaisesRegex(RuntimeError, expected),
            ):
                self.run_server(mode)

    def test_timeouts_cover_partial_frames_notification_flood_wrong_uri_and_exit(self):
        for mode in [
            "partial",
            "flood",
            "wrong-uri",
            "hang-exit",
            "exit-flood",
            "closed-pipes-exit",
        ]:
            started = time.monotonic()
            with (
                self.subTest(mode=mode),
                self.assertRaisesRegex(RuntimeError, "timed out"),
            ):
                self.run_server(mode, timeout=0.5)
            self.assertLess(time.monotonic() - started, 3)

    def test_cleanup_kills_process_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = """
import fcntl, os, signal, time
lock = open('lock', 'w')
fcntl.flock(lock, fcntl.LOCK_EX)
if os.fork() == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    time.sleep(30)
else:
    os.write(1, b'Content-Length: 38\\r\\n\\r\\n{"jsonrpc":"2.0","id":1,"result":null}')
    time.sleep(30)
"""
            with self.module.Client(
                [sys.executable, "-c", script], root, os.environ.copy(), 2
            ) as client:
                pid = client.process.pid
                client.receive(time.monotonic() + 2)
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
            with (root / "lock").open() as lock:
                deadline = time.monotonic() + 2
                while True:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            self.fail(
                                "server descendant survived cleanup and still holds lock"
                            )
                        time.sleep(0.01)

    def test_write_timeout_when_server_does_not_read(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            self.module.Client(
                [sys.executable, "-c", "import time; time.sleep(30)"],
                Path(directory),
                os.environ.copy(),
                0.2,
            ) as client,
            self.assertRaisesRegex(RuntimeError, "timed out writing"),
        ):
            client.send({"method": "large", "params": "x" * 1000000})

    def test_rejects_relative_command_instead_of_using_path(self):
        with self.assertRaisesRegex((ValueError, RuntimeError), "absolute"):
            self.module.verify(
                "json-ls",
                {"command": ["missing-server"]},
                Path(tempfile.gettempdir()),
                0.2,
            )


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--server":
        fake_server(sys.argv[2])
    else:
        unittest.main()
