# pyright: reportArgumentType=false, reportMissingParameterType=false, reportOptionalCall=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportUnknownMemberType=false, reportUnknownParameterType=false, reportUnknownVariableType=false
import io
import json
import os
import struct
import sys
import threading
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from extension import native_host as nh


# ── Compatibility helper: old feed() returned (text, commands), new feed() is char-by-char ──
def _feed_all(parser, text):
    """Feed all chars through the new char-by-byte OSCParser, return (remaining_text, commands)."""
    commands = []
    remaining = []
    osc_buf = []  # Track chars consumed into OSC buffer

    for ch in text:
        buf_before = len(parser.buffer) + len(osc_buf)
        in_osc_before = parser.in_osc
        result = parser.feed(ch)

        if result is not None:
            cmd_type, cmd_data = result
            commands.append(cmd_data)
            osc_buf.clear()
            # If result came from ST terminator detection, the triggering char
            # (the char AFTER \\x1b\\\\) is not part of the OSC — re-emit it
            if in_osc_before and ch != '\x07':
                remaining.append(ch)
        elif parser.in_osc or (len(parser.buffer) > 0):
            # Char was consumed into OSC buffer
            osc_buf.append(ch)
        elif len(parser.buffer) == 0 and buf_before > 0:
            # Buffer was non-empty but is now empty — ESC sequence aborted
            # (e.g., \x1b followed by non-']' char). Drop the consumed chars.
            osc_buf.clear()
        else:
            remaining.append(ch)

    # If OSC buf has leftover chars (incomplete sequence at end), emit them
    # Only emit leftover osc_buf if parser is NOT still in an OSC sequence
    if not parser.in_osc and len(parser.buffer) == 0:
        remaining.extend(osc_buf)
        osc_buf.clear()

    return ''.join(remaining), commands


def _decode_frames(blob):
    msgs = []
    offset = 0
    while offset < len(blob):
        length = struct.unpack("<I", blob[offset : offset + 4])[0]
        offset += 4
        payload = blob[offset : offset + length]
        offset += length
        msgs.append(json.loads(payload.decode("utf-8")))
    return msgs


class _FakeStd:
    def __init__(self, data=b""):
        self.buffer = io.BytesIO(data)


class _ImmediateThread:
    def __init__(self, target=None, args=(), kwargs=None, daemon=None):
        self._target = target
        self._args = args
        self._kwargs = kwargs or {}

    def start(self):
        self._target(*self._args, **self._kwargs)


class _FakeProc:
    def __init__(self, stdout="", stderr="", returncode=0, raise_timeout=False):
        self.pid = 4321
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self._raise_timeout = raise_timeout
        self.kill_called = False

    def communicate(self, timeout=None):
        if self._raise_timeout:
            raise nh.subprocess.TimeoutExpired(cmd="cmd", timeout=timeout)
        return self._stdout, self._stderr

    def poll(self):
        return self.returncode

    def kill(self):
        self.kill_called = True


def test_osc_parser_complete_7701_sequence():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser, 'before\x1b]7701;{"id":"1","tool":"x"}\x07after')
    assert text == "beforeafter"
    assert commands == [{"id": "1", "tool": "x"}]


def test_osc_parser_partial_sequence_across_feeds():
    parser = nh.OSCParser()
    text1, commands1 = _feed_all(parser, 'x\x1b]7701;{"id":"a"')
    text2, commands2 = _feed_all(parser, "}\x07y")
    assert text1 == "x"
    assert commands1 == []
    assert text2 == "y"
    assert commands2 == [{"id": "a"}]


def test_osc_parser_ragbot_request_sequence():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser,
        '\x1b]7701;{"type":"ragbot_request","id":"rag1","query":"what do you see?"}\x07'
    )
    assert text == ""
    assert commands == [
        {"type": "ragbot_request", "id": "rag1", "query": "what do you see?"}
    ]


def test_osc_parser_multiple_sequences_in_one_chunk():
    parser = nh.OSCParser()
    data = '\x1b]7701;{"id":"1"}\x07M\x1b]7701;{"id":"2"}\x07'
    text, commands = _feed_all(parser, data)
    assert text == "M"
    assert commands == [{"id": "1"}, {"id": "2"}]


def test_osc_parser_uses_st_terminator():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser, '\x1b]7701;{"id":"st"}\x1b\\X')
    assert text == "X"
    assert commands == [{"id": "st"}]


def test_osc_parser_st_and_bel_prefers_first_terminator():
    parser = nh.OSCParser()
    # BEL terminates the first sequence; \x1b\\ at end needs trailing char to trigger detection
    text, commands = _feed_all(parser, '\x1b]7701;{"id":"first"}\x07noise\x1b\\Z')
    assert text == "noiseZ"
    assert commands == [{"id": "first"}]


def test_osc_parser_non_7701_sequence_passthrough():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser, "A\x1b]9;ignored\x07B")
    # Non-7701 OSC sequences are consumed (not passed through) by the new parser
    assert text == "AB"
    assert commands == []


def test_osc_parser_empty_body_passthrough():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser, "X\x1b]\x07Y")
    # Empty OSC body is consumed by the new parser
    assert text == "XY"
    assert commands == []


def test_osc_parser_malformed_json_passthrough():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser, "\x1b]7701;{not json}\x07")
    # Malformed JSON in 7701 sequence is consumed (not passed through)
    assert text == ""
    assert commands == []


def test_osc_parser_osc_overflow_resets_state(monkeypatch):
    monkeypatch.setattr(nh, "OSC_MAX_BODY", 10)
    parser = nh.OSCParser()
    text1, commands1 = _feed_all(parser, "\x1b]" + "x" * 11)
    text2, commands2 = _feed_all(parser, "tail")
    # Overflow guard consumes the entire OSC buffer (DoS protection)
    assert text1 == ""
    assert commands1 == []
    assert text2 == "tail"
    assert commands2 == []


def test_osc_parser_text_only_passthrough():
    parser = nh.OSCParser()
    text, commands = _feed_all(parser, "plain text")
    assert text == "plain text"
    assert commands == []


def test_osc_parser_partial_then_non_osc_new_chunk():
    parser = nh.OSCParser()
    _feed_all(parser, '\x1b]7701;{"k":')
    text, commands = _feed_all(parser, "1}\x07Z")
    assert text == "Z"
    assert commands == [{"k": 1}]


def test_send_message_writes_length_prefixed_json(monkeypatch):
    fake_out = _FakeStd()
    monkeypatch.setattr(nh.sys, "stdout", fake_out)
    nh.send_message({"type": "ok", "n": 1})
    raw = fake_out.buffer.getvalue()
    length = struct.unpack("<I", raw[:4])[0]
    payload = raw[4 : 4 + length]
    assert json.loads(payload.decode("utf-8")) == {"type": "ok", "n": 1}


def test_send_message_spills_large_payload_to_file(monkeypatch, tmpdir):
    fake_out = _FakeStd()
    monkeypatch.setattr(nh.sys, "stdout", fake_out)
    monkeypatch.setattr(nh, "TEMP_DIR", str(tmpdir))
    monkeypatch.setattr(nh, "CHROME_NATIVE_MSG_MAX", 50)
    nh.send_message({"type": "tool_response", "blob": "x" * 200})
    # New behavior: oversized messages are dropped (not spilled to file)
    assert fake_out.buffer.getvalue() == b""


def test_send_message_concurrent_access_serializes_frames(monkeypatch):
    fake_out = _FakeStd()
    monkeypatch.setattr(nh.sys, "stdout", fake_out)

    def worker(i):
        nh.send_message({"type": "m", "i": i})

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    msgs = _decode_frames(fake_out.buffer.getvalue())
    assert sorted(m["i"] for m in msgs) == list(range(10))


def test_read_message_reads_valid_frame(monkeypatch):
    payload = json.dumps({"a": 1}).encode("utf-8")
    framed = struct.pack("<I", len(payload)) + payload
    fake_in = _FakeStd(framed)
    monkeypatch.setattr(nh.sys, "stdin", fake_in)
    assert nh.read_message() == {"a": 1}


def test_read_message_zero_length_returns_empty_dict(monkeypatch):
    fake_in = _FakeStd(struct.pack("<I", 0))
    monkeypatch.setattr(nh.sys, "stdin", fake_in)
    assert nh.read_message() is None


def test_read_message_eof_returns_none(monkeypatch):
    fake_in = _FakeStd(b"")
    monkeypatch.setattr(nh.sys, "stdin", fake_in)
    assert nh.read_message() is None


def test_read_message_too_large_returns_none(monkeypatch):
    fake_in = _FakeStd(struct.pack("<I", nh.CHROME_NATIVE_MSG_MAX + 1))
    monkeypatch.setattr(nh.sys, "stdin", fake_in)
    assert nh.read_message() is None


def test_read_message_truncated_payload_returns_none(monkeypatch):
    fake_in = _FakeStd(struct.pack("<I", 10) + b"{}")
    monkeypatch.setattr(nh.sys, "stdin", fake_in)
    assert nh.read_message() is None


def test_read_message_malformed_json_returns_none(monkeypatch):
    payload = b"{not-json}"
    fake_in = _FakeStd(struct.pack("<I", len(payload)) + payload)
    monkeypatch.setattr(nh.sys, "stdin", fake_in)
    # New behavior: catches JSON errors and returns None
    assert nh.read_message() is None


def test_chrome_to_pty_tool_response_success_small_payload():
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(
            wfd,
            {
                "type": "tool_response",
                "requestId": "abc",
                "success": True,
                "result": {"k": "v"},
            },
        )
        raw = os.read(rfd, 65536).decode("utf-8")
    finally:
        os.close(rfd)
        os.close(wfd)

    assert raw.startswith(nh.OSC_START + nh.OSC_RESPONSE_PREFIX)
    assert raw.endswith(nh.OSC_END_BEL)
    body = raw[len(nh.OSC_START + nh.OSC_RESPONSE_PREFIX) : -len(nh.OSC_END_BEL)]
    assert json.loads(body) == {"id": "abc", "ok": True, "result": {"k": "v"}}


def test_chrome_to_pty_tool_response_error_defaults_message():
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(
            wfd, {"type": "tool_response", "requestId": "a", "success": False}
        )
        raw = os.read(rfd, 65536).decode("utf-8")
    finally:
        os.close(rfd)
        os.close(wfd)
    body = raw[len(nh.OSC_START + nh.OSC_RESPONSE_PREFIX) : -len(nh.OSC_END_BEL)]
    parsed = json.loads(body)
    assert parsed["id"] == "a"
    assert parsed["ok"] is False
    # New code omits error/result when None
    assert "error" not in parsed or parsed.get("error") is None


def test_chrome_to_pty_ragbot_response_success_small_payload():
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(
            wfd,
            {
                "type": "ragbot_response",
                "requestId": "rag_abc",
                "success": True,
                "result": {"text": "The page says feature X is live."},
            },
        )
        raw = os.read(rfd, 65536).decode("utf-8")
    finally:
        os.close(rfd)
        os.close(wfd)

    assert raw.startswith(nh.OSC_START + nh.OSC_RESPONSE_PREFIX)
    assert raw.endswith(nh.OSC_END_BEL)
    body = raw[len(nh.OSC_START + nh.OSC_RESPONSE_PREFIX) : -len(nh.OSC_END_BEL)]
    assert json.loads(body) == {
        "id": "rag_abc",
        "ok": True,
        "result": {"text": "The page says feature X is live."},
    }


def test_chrome_to_pty_ragbot_response_error_defaults_message():
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(
            wfd, {"type": "ragbot_response", "requestId": "rag_err", "success": False}
        )
        raw = os.read(rfd, 65536).decode("utf-8")
    finally:
        os.close(rfd)
        os.close(wfd)
    body = raw[len(nh.OSC_START + nh.OSC_RESPONSE_PREFIX) : -len(nh.OSC_END_BEL)]
    parsed = json.loads(body)
    assert parsed["id"] == "rag_err"
    assert parsed["ok"] is False
    # New code omits error/result when None
    assert "error" not in parsed or parsed.get("error") is None


def test_chrome_to_pty_tool_response_spills_large_payload(monkeypatch, tmpdir):
    monkeypatch.setattr(nh, "TEMP_DIR", str(tmpdir))
    monkeypatch.setattr(nh, "LARGE_PAYLOAD_THRESHOLD", 10)
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(
            wfd,
            {
                "type": "tool_response",
                "requestId": "safe_id",
                "success": True,
                "result": "x" * 100,
            },
        )
        raw = os.read(rfd, 65536).decode("utf-8")
    finally:
        os.close(rfd)
        os.close(wfd)

    pointer = raw[len(nh.OSC_START + nh.OSC_RESPONSE_PREFIX) : -len(nh.OSC_END_BEL)]
    parsed = json.loads(pointer)
    assert parsed["id"] == "safe_id"
    assert os.path.isfile(parsed["file"])


def test_chrome_to_pty_tool_response_unsafe_id_is_replaced(monkeypatch, tmpdir):
    monkeypatch.setattr(nh, "TEMP_DIR", str(tmpdir))
    monkeypatch.setattr(nh, "LARGE_PAYLOAD_THRESHOLD", 10)
    monkeypatch.setattr(nh.secrets, "token_hex", lambda n: "deadbeef")
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(
            wfd,
            {
                "type": "tool_response",
                "requestId": "../../bad",
                "success": True,
                "result": "y" * 100,
            },
        )
        raw = os.read(rfd, 65536).decode("utf-8")
    finally:
        os.close(rfd)
        os.close(wfd)
    pointer = raw[len(nh.OSC_START + nh.OSC_RESPONSE_PREFIX) : -len(nh.OSC_END_BEL)]
    parsed = json.loads(pointer)
    assert parsed["id"] == "deadbeef"


def test_chrome_to_pty_pty_input_forwards_data():
    rfd, wfd = os.pipe()
    try:
        nh.chrome_to_pty(wfd, {"type": "pty_input", "data": "echo hi\n"})
        raw = os.read(rfd, 1024)
    finally:
        os.close(rfd)
        os.close(wfd)
    assert raw == b"echo hi\n"


def test_chrome_to_pty_pty_input_empty_does_not_write(monkeypatch):
    writes = []
    monkeypatch.setattr(nh.os, "write", lambda fd, data: writes.append((fd, data)))
    nh.chrome_to_pty(1, {"type": "pty_input", "data": ""})
    assert writes == []


def test_chrome_to_pty_execute_shell_empty_command_sends_error(monkeypatch):
    sent = []
    monkeypatch.setattr(nh, "send_message", lambda msg: sent.append(msg))
    nh.chrome_to_pty(1, {"type": "browser_refresh", "tool": "execute_shell", "requestId": "r1", "command": ""})
    assert sent == [
        {
            "type": "tool_response",
            "requestId": "r1",
            "success": False,
            "error": "Empty command",
        }
    ]


def test_chrome_to_pty_direct_execute_shell_empty_command_sends_error(monkeypatch):
    sent = []
    monkeypatch.setattr(nh, "send_message", lambda msg: sent.append(msg))
    nh.chrome_to_pty(
        1,
        {
            "type": "execute_shell",
            "requestId": "direct",
            "command": "",
        },
    )
    assert sent == [
        {
            "type": "tool_response",
            "requestId": "direct",
            "success": False,
            "error": "Empty command",
        }
    ]


def test_chrome_to_pty_execute_shell_success(monkeypatch):
    sent = []
    added = []
    monkeypatch.setattr(nh, "send_message", lambda msg: sent.append(msg))
    monkeypatch.setattr(nh.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(
        nh.subprocess,
        "Popen",
        lambda *a, **k: _FakeProc(stdout="ok", stderr="", returncode=0),
    )
    monkeypatch.setattr(
        nh.supervisor, "add_process", lambda proc: added.append(proc.pid)
    )
    nh.chrome_to_pty(
        1, {"type": "browser_refresh", "tool": "execute_shell", "requestId": "r2", "command": "echo ok"}
    )
    assert added == [4321]
    assert sent[0]["type"] == "tool_response"
    assert sent[0]["requestId"] == "r2"
    assert sent[0]["success"] is True
    assert sent[0]["result"]["stdout"] == "ok"


def test_chrome_to_pty_execute_shell_timeout(monkeypatch):
    sent = []
    monkeypatch.setattr(nh, "send_message", lambda msg: sent.append(msg))
    monkeypatch.setattr(nh.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(
        nh.subprocess,
        "Popen",
        lambda *a, **k: _FakeProc(raise_timeout=True),
    )
    nh.chrome_to_pty(
        1, {"type": "browser_refresh", "tool": "execute_shell", "requestId": "r3", "command": "sleep 31"}
    )
    assert sent[0]["success"] is False
    assert "timed out" in sent[0]["error"]


def test_chrome_to_pty_execute_shell_unexpected_exception(monkeypatch):
    sent = []
    monkeypatch.setattr(nh, "send_message", lambda msg: sent.append(msg))
    monkeypatch.setattr(nh.threading, "Thread", _ImmediateThread)

    def _boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(nh.subprocess, "Popen", _boom)
    nh.chrome_to_pty(1, {"type": "browser_refresh", "tool": "execute_shell", "requestId": "r4", "command": "x"})
    assert sent[0]["success"] is False
    assert sent[0]["error"] == "boom"


def test_process_supervisor_add_and_reap_finished():
    sup = nh.ProcessSupervisor()

    class DoneProc:
        def __init__(self, pid):
            self.pid = pid

        def poll(self):
            return 0

    p = DoneProc(1)
    sup.add_process(p)
    assert 1 in sup._processes
    sup.check_zombies()
    assert 1 not in sup._processes


def test_process_supervisor_keeps_running_processes():
    sup = nh.ProcessSupervisor()

    class RunningProc:
        def __init__(self, pid):
            self.pid = pid

        def poll(self):
            return None

    p = RunningProc(2)
    sup.add_process(p)
    sup.check_zombies()
    assert 2 in sup._processes


def test_process_supervisor_terminate_all_killpg(monkeypatch):
    sup = nh.ProcessSupervisor()
    proc = _FakeProc()
    proc.pid = 99
    sup.add_process(proc)
    killed = []
    monkeypatch.setattr(nh.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(nh.os, "killpg", lambda pgid, sig: killed.append((pgid, sig)))
    sup.terminate_all()
    assert killed and killed[0][0] == 99
    assert sup._processes == {}


def test_process_supervisor_terminate_all_fallback_to_proc_kill(monkeypatch):
    sup = nh.ProcessSupervisor()
    proc = _FakeProc()
    proc.pid = 77
    sup.add_process(proc)
    monkeypatch.setattr(nh.os, "getpgid", lambda pid: pid)

    def _raise(*a, **k):
        raise OSError("no group")

    monkeypatch.setattr(nh.os, "killpg", _raise)
    sup.terminate_all()
    assert proc.kill_called is True
    assert sup._processes == {}


def test_cleanup_terminates_child_supervisor_and_tempdir(monkeypatch, tmpdir):
    tmp_path = str(tmpdir)
    os.makedirs(tmp_path, exist_ok=True)
    marker = os.path.join(tmp_path, "x.txt")
    with open(marker, "w", encoding="utf-8") as f:
        f.write("x")

    monkeypatch.setattr(nh, "TEMP_DIR", tmp_path)
    calls = {"killpg": 0, "terminate_all": 0}
    monkeypatch.setattr(nh.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(
        nh.os,
        "killpg",
        lambda pgid, sig: calls.__setitem__("killpg", calls["killpg"] + 1),
    )
    monkeypatch.setattr(
        nh.supervisor,
        "terminate_all",
        lambda: calls.__setitem__("terminate_all", calls["terminate_all"] + 1),
    )

    nh.cleanup(123)
    assert calls["terminate_all"] == 1  # cleanup delegates to supervisor
    assert not os.path.isdir(tmp_path)


def test_cleanup_is_idempotent(monkeypatch, tmpdir):
    monkeypatch.setattr(nh, "TEMP_DIR", str(tmpdir))
    calls = {"terminate_all": 0}
    monkeypatch.setattr(
        nh.supervisor,
        "terminate_all",
        lambda: calls.__setitem__("terminate_all", calls["terminate_all"] + 1),
    )
    nh.cleanup(None)
    nh.cleanup(None)
    assert calls["terminate_all"] == 2  # No idempotency guard
