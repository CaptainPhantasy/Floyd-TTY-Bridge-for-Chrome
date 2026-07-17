"""
End-to-end tests for the Floyd TTY Bridge native host.

Spawns native_host.py as a real subprocess (simulating Chrome's native messaging),
communicates via length-prefixed JSON on stdin/stdout, and verifies the full
message pipeline: boot → PTY I/O → OSC parsing → SDK round-trip.

These are NOT unit tests. They exercise real PTYs, real subprocesses, and real
OSC escape sequence parsing.
"""

# pyright: reportOptionalMemberAccess=false, reportOptionalIterable=false
import json
import os
import queue
import struct
import subprocess
import sys
import threading
import time

import pytest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NATIVE_HOST = os.path.join(PROJECT_ROOT, "extension", "native_host.py")
SDK_PATH = os.path.join(PROJECT_ROOT, "extension", "floyd-tools.sh")


class NativeHostBridge:
    """Spawn native_host.py and communicate as Chrome native messaging would."""

    def __init__(self):
        self.proc = None
        self._messages = queue.Queue()
        self._reader = None
        self._stderr_lines = []

    def start(self):
        self.proc = subprocess.Popen(
            [sys.executable, NATIVE_HOST],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=PROJECT_ROOT,
        )
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        stderr_t = threading.Thread(target=self._stderr_loop, daemon=True)
        stderr_t.start()

    def _read_loop(self):
        while self.proc and self.proc.poll() is None:
            try:
                len_bytes = self.proc.stdout.read(4)
                if not len_bytes or len(len_bytes) < 4:
                    break
                msg_len = struct.unpack("<I", len_bytes)[0]
                if msg_len > 1024 * 1024:
                    break
                data = self.proc.stdout.read(msg_len)
                if len(data) < msg_len:
                    break
                msg = json.loads(data.decode("utf-8"))
                self._messages.put(msg)
            except Exception:
                break

    def _stderr_loop(self):
        try:
            for line in self.proc.stderr:
                self._stderr_lines.append(
                    line.decode("utf-8", errors="replace").rstrip()
                )
        except Exception:
            pass

    def send(self, msg: dict):
        """Send a length-prefixed JSON message (Chrome → native host)."""
        data = json.dumps(msg, separators=(",", ":")).encode("utf-8")
        self.proc.stdin.write(struct.pack("<I", len(data)))
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def wait_for(self, predicate, timeout=15):
        """Wait for a message matching predicate. Returns (match, all_collected)."""
        deadline = time.time() + timeout
        collected = []
        while time.time() < deadline:
            try:
                msg = self._messages.get(timeout=0.2)
                collected.append(msg)
                if predicate(msg):
                    return msg, collected
            except queue.Empty:
                continue
        return None, collected

    def wait_for_type(self, msg_type, timeout=15):
        """Wait for a specific message type."""
        return self.wait_for(lambda m: m.get("type") == msg_type, timeout=timeout)

    def drain(self, timeout=1):
        """Drain all pending messages."""
        msgs = []
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                msgs.append(self._messages.get(timeout=0.1))
            except queue.Empty:
                continue
        return msgs

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=2)


@pytest.fixture
def bridge():
    b = NativeHostBridge()
    b.start()
    yield b
    b.stop()


# ---------------------------------------------------------------------------
# Test 1: Boot Handshake
# ---------------------------------------------------------------------------


class TestBootHandshake:
    def test_ready_message_on_startup(self, bridge):
        """native_host.py sends a 'ready' message with version, pid, and shell."""
        msg, _ = bridge.wait_for_type("ready", timeout=20)
        assert msg is not None, "No 'ready' message received within 20s"
        assert msg["type"] == "ready"
        assert msg["version"] == "4.7"
        assert isinstance(msg["pid"], int)
        assert msg["pid"] > 0
        assert "shell" in msg
        assert isinstance(msg["shell"], str)


# ---------------------------------------------------------------------------
# Test 2: PTY I/O
# ---------------------------------------------------------------------------


class TestPTYIO:
    def test_echo_command_produces_output(self, bridge):
        """Typing a command in the PTY produces pty_output containing the result."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        # Let shell settle (prompt, motd, .zshrc)
        time.sleep(3)
        bridge.drain(timeout=1)

        marker = "FLOYD_E2E_ECHO_9876"
        bridge.send({"type": "pty_input", "data": f"echo {marker}\r"})

        msg, collected = bridge.wait_for(
            lambda m: m.get("type") == "pty_output" and marker in m.get("data", ""),
            timeout=10,
        )
        assert msg is not None, (
            f"Marker '{marker}' not found in pty_output. "
            f"Got {len(collected)} messages: "
            f"{[(m.get('type'), m.get('data', '')[:80]) for m in collected]}"
        )

    def test_env_variable_set_in_pty(self, bridge):
        """The PTY shell has FLOYD_TTY_BRIDGE environment variable set."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        time.sleep(3)
        bridge.drain(timeout=1)

        marker = "ENVCHECK_"
        bridge.send({"type": "pty_input", "data": f"echo {marker}$FLOYD_TTY_BRIDGE\r"})

        msg, _ = bridge.wait_for(
            lambda m: m.get("type") == "pty_output"
            and f"{marker}4.7" in m.get("data", ""),
            timeout=10,
        )
        assert msg is not None, "FLOYD_TTY_BRIDGE not set to 4.7 in PTY"


# ---------------------------------------------------------------------------
# Test 3: execute_shell
# ---------------------------------------------------------------------------


class TestExecuteShell:
    def test_shell_command_returns_stdout(self, bridge):
        """execute_shell runs a command and returns structured result."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        bridge.send(
            {
                "type": "execute_shell",
                "requestId": "e2e_shell_1",
                "command": "echo e2e_stdout_test",
            }
        )

        msg, _ = bridge.wait_for(
            lambda m: m.get("type") == "tool_response"
            and m.get("requestId") == "e2e_shell_1",
            timeout=15,
        )
        assert msg is not None, "No tool_response for execute_shell"
        assert msg["success"] is True
        assert "e2e_stdout_test" in msg["result"]["stdout"]
        assert msg["result"]["exitCode"] == 0

    def test_shell_command_captures_stderr(self, bridge):
        """execute_shell captures stderr separately."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        bridge.send(
            {
                "type": "execute_shell",
                "requestId": "e2e_shell_2",
                "command": "echo e2e_err >&2",
            }
        )

        msg, _ = bridge.wait_for(
            lambda m: m.get("type") == "tool_response"
            and m.get("requestId") == "e2e_shell_2",
            timeout=15,
        )
        assert msg is not None
        assert "e2e_err" in msg["result"]["stderr"]

    def test_shell_command_nonzero_exit(self, bridge):
        """execute_shell reports non-zero exit codes."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        bridge.send(
            {
                "type": "execute_shell",
                "requestId": "e2e_shell_3",
                "command": "exit 42",
            }
        )

        msg, _ = bridge.wait_for(
            lambda m: m.get("type") == "tool_response"
            and m.get("requestId") == "e2e_shell_3",
            timeout=15,
        )
        assert msg is not None
        assert msg["success"] is False
        assert msg["result"]["exitCode"] == 42

    def test_shell_empty_command_returns_error(self, bridge):
        """execute_shell with empty command returns an error."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        bridge.send(
            {
                "type": "execute_shell",
                "requestId": "e2e_shell_4",
                "command": "",
            }
        )

        msg, _ = bridge.wait_for(
            lambda m: m.get("type") == "tool_response"
            and m.get("requestId") == "e2e_shell_4",
            timeout=15,
        )
        assert msg is not None
        assert msg["success"] is False
        assert "Empty command" in msg.get("error", "")


# ---------------------------------------------------------------------------
# Test 4: Raw OSC 7701 Parsing (no SDK, just raw escape sequences)
# ---------------------------------------------------------------------------


class TestOSCParsing:
    def test_raw_osc_7701_produces_tool_call(self, bridge):
        """A raw OSC 7701 sequence written to the PTY is parsed into a tool_call message."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        time.sleep(3)
        bridge.drain(timeout=1)

        # Write a raw OSC 7701 sequence directly to the PTY via printf
        osc_json = '{"id":"e2e_raw_1","tool":"get_page_state","args":{}}'
        bridge.send(
            {
                "type": "pty_input",
                "data": f"printf '\\033]7701;{osc_json}\\007'\r",
            }
        )

        msg, collected = bridge.wait_for(
            lambda m: m.get("type") == "tool_call"
            and m.get("tool") == "get_page_state",
            timeout=15,
        )
        assert msg is not None, (
            "No tool_call received for raw OSC 7701. "
            f"Got: {[(m.get('type'), m.get('data', '')[:60]) for m in collected]}"
        )
        assert msg["requestId"] == "e2e_raw_1"
        assert msg["tool"] == "get_page_state"
        assert msg["args"] == {}


# ---------------------------------------------------------------------------
# Test 5: SDK Tool Call (source SDK, call floyd_call)
# ---------------------------------------------------------------------------


class TestSDKToolCall:
    def test_floyd_call_generates_tool_call_message(self, bridge):
        """Sourcing floyd-tools.sh and calling floyd_call produces a tool_call message."""
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        time.sleep(3)
        bridge.drain(timeout=1)

        # Source SDK and call a tool — runs in background so the shell doesn't
        # block waiting for a response that never comes. We just need to verify
        # the tool_call message arrives.
        bridge.send(
            {
                "type": "pty_input",
                "data": (f"source '{SDK_PATH}' && floyd_call get_page_state &\r"),
            }
        )

        msg, collected = bridge.wait_for(
            lambda m: m.get("type") == "tool_call"
            and m.get("tool") == "get_page_state",
            timeout=15,
        )
        assert msg is not None, (
            "SDK floyd_call did not produce a tool_call message. "
            f"Got: {[(m.get('type'), m.get('data', '')[:60]) for m in collected]}"
        )
        assert msg["tool"] == "get_page_state"
        assert "requestId" in msg


# ---------------------------------------------------------------------------
# Test 6: Full SDK Round-Trip (tool_call → mock response → SDK output)
# ---------------------------------------------------------------------------


class TestSDKRoundTrip:
    def test_full_round_trip(self, bridge):
        """
        Complete round-trip:
        1. Source SDK, call floyd_call
        2. Receive tool_call message
        3. Send mock tool_response back
        4. Verify SDK outputs the mock data to the PTY
        """
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        time.sleep(3)
        bridge.drain(timeout=1)

        # Source SDK and call floyd_call (foreground — SDK blocks waiting for response)
        bridge.send(
            {
                "type": "pty_input",
                "data": f"source '{SDK_PATH}' && floyd_call get_page_state\r",
            }
        )

        # Wait for the tool_call message from native_host.py
        tool_call, _ = bridge.wait_for(
            lambda m: m.get("type") == "tool_call"
            and m.get("tool") == "get_page_state",
            timeout=15,
        )
        assert tool_call is not None, "No tool_call message received"

        # Send mock Chrome response
        mock_url = "https://e2e-verified.example.com"
        bridge.send(
            {
                "type": "tool_response",
                "requestId": tool_call["requestId"],
                "success": True,
                "result": {"url": mock_url, "title": "E2E Verified"},
            }
        )

        # The SDK should echo the response JSON to the terminal.
        # Verify our unique URL appears in pty_output.
        msg, collected = bridge.wait_for(
            lambda m: m.get("type") == "pty_output"
            and "e2e-verified.example.com" in m.get("data", ""),
            timeout=15,
        )
        assert msg is not None, (
            "Mock response URL not found in PTY output after round-trip. "
            f"Collected {len(collected)} messages: "
            f"{[(m.get('type'), m.get('data', '')[:80]) for m in collected]}"
        )


class TestTomBridgeRoundTrip:
    def test_floyd_ask_tom_generates_ragbot_request(self, bridge):
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        time.sleep(3)
        bridge.drain(timeout=1)

        bridge.send(
            {
                "type": "pty_input",
                "data": f"source '{SDK_PATH}' && floyd_ask_tom 'what do you see?' &\r",
            }
        )

        msg, collected = bridge.wait_for(
            lambda m: m.get("type") == "ragbot_request"
            and m.get("query") == "what do you see?",
            timeout=15,
        )
        assert msg is not None, (
            "SDK floyd_ask_tom did not produce a ragbot_request message. "
            f"Got: {[(m.get('type'), m.get('data', '')[:60]) for m in collected]}"
        )
        assert "requestId" in msg

    def test_floyd_ask_tom_round_trip(self, bridge):
        ready, _ = bridge.wait_for_type("ready", timeout=20)
        assert ready is not None

        time.sleep(3)
        bridge.drain(timeout=1)

        bridge.send(
            {
                "type": "pty_input",
                "data": f"source '{SDK_PATH}' && floyd_ask_tom 'summarize the page'\r",
            }
        )

        ragbot_request, _ = bridge.wait_for(
            lambda m: m.get("type") == "ragbot_request"
            and m.get("query") == "summarize the page",
            timeout=15,
        )
        assert ragbot_request is not None, "No ragbot_request message received"

        bridge.send(
            {
                "type": "ragbot_response",
                "requestId": ragbot_request["requestId"],
                "success": True,
                "result": {
                    "text": "The page highlights feature parity and local-first sync."
                },
            }
        )

        msg, collected = bridge.wait_for(
            lambda m: m.get("type") == "pty_output"
            and "feature parity and local-first sync" in m.get("data", ""),
            timeout=15,
        )
        assert msg is not None, (
            "Mock ragbot response text not found in PTY output after round-trip. "
            f"Collected {len(collected)} messages: "
            f"{[(m.get('type'), m.get('data', '')[:80]) for m in collected]}"
        )
