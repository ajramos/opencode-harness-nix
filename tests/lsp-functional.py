"""Offline LSP diagnostic smoke test, using generated command arrays verbatim."""

import json
import os
import selectors
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

FIXTURES = {
    "nixd": ("default.nix", "nix", "let value = ; in value\n", {}),
    "typescript": (
        "main.ts",
        "typescript",
        'const value: number = "wrong";\n',
        {"tsconfig.json": '{"compilerOptions":{"strict":true},"include":["main.ts"]}'},
    ),
    "pyright": (
        "main.py",
        "python",
        'value: int = "wrong"\n',
        {"pyrightconfig.json": '{"typeCheckingMode":"basic"}'},
    ),
    "bash": ("main.sh", "shellscript", "#!/bin/bash\nif then\n", {}),
    "yaml-ls": ("main.yaml", "yaml", "value: [\n", {}),
    "json-ls": ("main.json", "json", '{"value": }\n', {}),
    "gopls": (
        "main.go",
        "go",
        'package main\nfunc main() { var value int = "wrong"; _ = value }\n',
        {"go.mod": "module example.com/lsp-smoke\n\ngo 1.22\n"},
    ),
}


class Client:
    def __init__(self, command, root, env, timeout):
        self.timeout = timeout
        self.buffer = bytearray()
        self.stderr = bytearray()
        self.next_id = 0
        self.group_stopped = False
        self.folders = [{"uri": root.as_uri(), "name": "lsp-smoke"}]
        self.selector = selectors.DefaultSelector()
        self.process = subprocess.Popen(
            command,
            cwd=root,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            assert stream is not None
            os.set_blocking(stream.fileno(), False)
        assert self.process.stdout is not None and self.process.stderr is not None
        self.selector.register(self.process.stdout, selectors.EVENT_READ)
        self.selector.register(self.process.stderr, selectors.EVENT_READ)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        # Include descendants (tsserver, go, shellcheck), even if the parent exited.
        self.process.poll()
        self.stop_process_group()
        self.process.wait()
        self.selector.close()
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            assert stream is not None
            stream.close()

    def stop_process_group(self):
        if self.group_stopped:
            return
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.group_stopped = True

    def send(self, message):
        assert self.process.stdin is not None
        body = json.dumps({"jsonrpc": "2.0", **message}).encode()
        data = memoryview(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
        deadline = time.monotonic() + self.timeout
        with selectors.DefaultSelector() as writable:
            writable.register(self.process.stdin, selectors.EVENT_WRITE)
            while data:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not writable.select(remaining):
                    raise RuntimeError("timed out writing to server")
                data = data[os.write(self.process.stdin.fileno(), data) :]

    def receive(self, deadline):
        while True:
            if time.monotonic() >= deadline:
                raise RuntimeError("timed out waiting for server")
            boundary = self.buffer.find(b"\r\n\r\n")
            if boundary >= 0:
                headers = {}
                for line in self.buffer[:boundary].decode("ascii").split("\r\n"):
                    key, value = line.split(":", 1)
                    headers[key.lower()] = value.strip()
                try:
                    length = int(headers["content-length"])
                    if not 0 <= length <= 8 * 1024 * 1024:
                        raise ValueError()
                except (KeyError, ValueError) as error:
                    raise RuntimeError("invalid Content-Length") from error
                end = boundary + 4 + length
                if len(self.buffer) >= end:
                    message = json.loads(self.buffer[boundary + 4 : end])
                    del self.buffer[:end]
                    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                        raise RuntimeError("invalid JSON-RPC message")
                    return message
            elif len(self.buffer) > 8192:
                raise RuntimeError("oversized LSP header")
            events = self.selector.select(max(0, deadline - time.monotonic()))
            # Drain stderr before reporting stdout EOF so startup errors survive.
            events.sort(key=lambda event: event[0].fileobj is self.process.stdout)
            for key, _ in events:
                chunk = os.read(key.fd, 65536)
                if key.fileobj is self.process.stderr:
                    self.stderr.extend(chunk)
                    del self.stderr[:-16384]
                    if not chunk:
                        self.selector.unregister(key.fileobj)
                elif not chunk:
                    raise RuntimeError("server closed stdout")
                else:
                    self.buffer.extend(chunk)

    def wait_for(self, predicate):
        deadline = time.monotonic() + self.timeout
        while True:
            message = self.receive(deadline)
            if "method" in message and "id" in message:
                method = message["method"]
                reply = {"id": message["id"], "result": None}
                if method == "workspace/configuration":
                    reply["result"] = [
                        {} for _ in message.get("params", {}).get("items", [])
                    ]
                elif method == "workspace/workspaceFolders":
                    reply["result"] = self.folders
                elif method not in (
                    "client/registerCapability",
                    "client/unregisterCapability",
                    "window/workDoneProgress/create",
                    "window/showMessageRequest",
                ):
                    reply = {
                        "id": message["id"],
                        "error": {"code": -32601, "message": "Method not supported"},
                    }
                self.send(reply)
            elif predicate(message):
                if "error" in message:
                    raise RuntimeError(f"JSON-RPC error: {message['error']}")
                return message

    def request(self, method, params=None):
        self.next_id += 1
        request_id = self.next_id
        self.send({"id": request_id, "method": method, "params": params})
        message = self.wait_for(
            lambda message: "method" not in message and message.get("id") == request_id
        )
        if "result" not in message:
            raise RuntimeError("response missing result")
        return message["result"]

    def wait_for_exit(self):
        deadline = time.monotonic() + self.timeout
        # No more protocol replies are needed; discard stdout and retain stderr's tail.
        self.buffer.clear()
        while self.selector.get_map():
            status = self.process.poll()
            if status is not None:
                self.stop_process_group()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("timed out waiting for exit")
            # Parent death need not make pipes readable: descendants may hold them.
            events = self.selector.select(
                0 if status is not None else min(remaining, 0.05)
            )
            if status is not None and not events:
                return status
            for key, _ in events:
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    self.selector.unregister(key.fileobj)
                elif key.fileobj is self.process.stderr:
                    self.stderr.extend(chunk)
                    del self.stderr[:-16384]
        try:
            return self.process.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("timed out waiting for exit") from error


def verify(name, settings, root, timeout=60):
    command = settings["command"]
    if not command or not Path(command[0]).is_absolute():
        raise ValueError("generated command must use an absolute executable path")
    filename, language, text, files = FIXTURES[name]
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    env = {
        key: value for key, value in os.environ.items() if key in ("PATH", "SystemRoot")
    }
    for variable, directory in {
        "HOME": "home",
        "XDG_CACHE_HOME": "cache",
        "XDG_CONFIG_HOME": "config",
        "XDG_DATA_HOME": "data",
        "XDG_STATE_HOME": "state",
        "TMPDIR": "tmp",
        "GOCACHE": "go-cache",
        "GOPATH": "go",
        "GOMODCACHE": "go-mod",
        # nixd workers need a writable database, not the build host's Nix store.
        "NIX_REMOTE": "nix-store",
    }.items():
        path = root / directory
        path.mkdir(exist_ok=True)
        env[variable] = str(path)
    env.update(
        {
            "GOPROXY": "off",
            "GOSUMDB": "off",
            "GOTOOLCHAIN": "local",
            "CGO_ENABLED": "0",
            "PYTHONNOUSERSITE": "1",
            "LC_ALL": "C.UTF-8",
        }
    )
    env.update(settings.get("env", {}))
    if name == "nixd":
        # Serialize schema creation before nixd's two evaluation workers open it.
        subprocess.run(
            ["nix-store", "--init"], cwd=root, env=env, check=True, timeout=timeout
        )
    for path, content in {**files, filename: text}.items():
        (root / path).write_text(content)
    uri = (root / filename).as_uri()
    with Client(command, root, env, timeout) as client:
        try:
            result = client.request(
                "initialize",
                {
                    "processId": os.getpid(),
                    "rootUri": root.as_uri(),
                    "workspaceFolders": client.folders,
                    "capabilities": {
                        "workspace": {"configuration": True, "workspaceFolders": True},
                        "textDocument": {
                            "publishDiagnostics": {"versionSupport": True}
                        },
                    },
                    "initializationOptions": settings.get("initialization", {}),
                },
            )
            if not isinstance(result, dict) or not isinstance(
                result.get("capabilities"), dict
            ):
                raise TypeError("initialize did not return capabilities")
            client.send({"method": "initialized", "params": {}})
            client.send(
                {
                    "method": "textDocument/didOpen",
                    "params": {
                        "textDocument": {
                            "uri": uri,
                            "languageId": language,
                            "version": 1,
                            "text": text,
                        }
                    },
                }
            )
            client.wait_for(
                lambda message: (
                    message.get("method") == "textDocument/publishDiagnostics"
                    and message.get("params", {}).get("uri") == uri
                    and message["params"].get("version", 1) == 1
                    and any(
                        d.get("severity") == 1
                        and d.get("message")
                        and isinstance(d.get("range"), dict)
                        for d in message["params"].get("diagnostics", [])
                    )
                )
            )
            if client.request("shutdown") is not None:
                raise RuntimeError("shutdown result must be null")
            client.send({"method": "exit"})
            status = client.wait_for_exit()
            if status:
                raise RuntimeError(f"server exited with status {status}")
        except Exception as error:
            raise RuntimeError(
                f"{name}: {error}\nstderr (tail):\n{client.stderr.decode(errors='replace')}"
            ) from error


def main():
    settings = json.loads(Path(sys.argv[1]).read_text())
    if set(settings) != set(FIXTURES):
        raise ValueError(
            f"expected exactly these generated servers: {sorted(FIXTURES)}"
        )
    with tempfile.TemporaryDirectory(prefix="lsp-functional-") as directory:
        for name, server in settings.items():
            verify(name, server, Path(directory) / name)
            print(
                f"PASS {name}: initialize, didOpen, error diagnostic, shutdown, exit",
                flush=True,
            )


if __name__ == "__main__":
    main()
