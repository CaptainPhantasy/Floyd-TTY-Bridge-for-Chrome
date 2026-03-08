#!/usr/bin/env python3
"""
Floyd's Labs TTY Bridge -- Native Messaging Host v4.0

Bridges a PTY shell to Chrome's native messaging protocol.
LLM agents communicate via OSC 7701/7702 escape sequences.

Protocol:
  Agent -> Browser:  \\x1b]7701;{json}\\x07
  Browser -> Agent:  \\x1b]7702;{json}\\x07
  Large payloads:    Written to /tmp/floyd/ as files, path sent in response

Wire format (Chrome native messaging):
  4-byte little-endian uint32 length prefix, followed by UTF-8 JSON.
"""

import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import atexit
import shutil
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEMP_DIR = "/tmp/floyd"
LARGE_PAYLOAD_THRESHOLD = 16 * 1024  # 16 KB
PTY_READ_SIZE = 4096

OSC_START = "\x1b]"
OSC_END = "\x07"
OSC_COMMAND_PREFIX = "7701;"
OSC_RESPONSE_PREFIX = "7702;"

# ---------------------------------------------------------------------------
# Process Supervisor — manages background and orphaned processes
# ---------------------------------------------------------------------------

class ProcessSupervisor:
    """
    Tracks and manages child processes to prevent zombies and hangs.
    """
    def __init__(self):
        self._processes: dict[int, subprocess.Popen] = {}
        self._lock = threading.Lock()

    def add_process(self, proc: subprocess.Popen):
        with self._lock:
            self._processes[proc.pid] = proc

    def check_zombies(self):
        """Reaps finished processes."""
        with self._lock:
            finished = []
            for pid, proc in self._processes.items():
                if proc.poll() is not None:
                    finished.append(pid)
            for pid in finished:
                del self._processes[pid]

    def terminate_all(self):
        """Kill everything on shutdown."""
        with self._lock:
            for pid, proc in self._processes.items():
                try:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                except Exception:
                    try:
                        proc.kill()
                    except Exception:
                        pass
            self._processes.clear()

supervisor = ProcessSupervisor()

# ---------------------------------------------------------------------------
# Chrome native messaging I/O (stdin/stdout are the Chrome channel)
# ---------------------------------------------------------------------------

def send_message(msg: dict) -> None:
    """Write a length-prefixed JSON message to stdout (Chrome native messaging)."""
    encoded = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    length = struct.pack("I", len(encoded))
    sys.stdout.buffer.write(length)
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_message() -> Optional[dict]:
    """Read a length-prefixed JSON message from stdin. Returns None on EOF or blocking."""
    try:
        # Check if stdin has data waiting (timeout 0.1s) to prevent blocking
        ready, _, _ = select.select([sys.stdin], [], [], 0.1)
        if not ready:
            return {} # Return empty dict to signify 'no message yet' instead of None (EOF)

        raw_length = sys.stdin.buffer.read(4)
        if len(raw_length) < 4:
            return None # EOF
        length = struct.unpack("I", raw_length)[0]
        if length == 0:
            return {}
        
        # Read the exact payload
        data = sys.stdin.buffer.read(length)
        if len(data) < length:
            return None # EOF or broken pipe
            
        return json.loads(data.decode("utf-8"))
    except Exception as e:
        # Log to file or ignore
        return None


# ---------------------------------------------------------------------------
# OSC sequence parser — handles partial reads across PTY chunks
# ---------------------------------------------------------------------------

class OSCParser:
    """
    Scans a stream of PTY output for OSC 7701 escape sequences.

    A single PTY read can contain:
      - Plain text with no OSC sequences
      - A complete OSC 7701 sequence
      - Multiple OSC 7701 sequences
      - A partial OSC sequence split across reads
      - A mix of plain text and OSC sequences

    This parser buffers incomplete sequences and yields (text, commands)
    tuples where `text` is passthrough terminal output and `commands` is
    a list of parsed JSON command dicts.
    """

    def __init__(self):
        self._buffer = ""
        self._in_osc = False
        self._osc_body = ""

    def feed(self, data: str) -> tuple[str, list[dict]]:
        """
        Feed raw PTY output into the parser.

        Returns:
            (passthrough_text, list_of_parsed_commands)
        """
        text_parts: list[str] = []
        commands: list[dict] = []

        i = 0
        while i < len(data):
            if self._in_osc:
                # We are inside an OSC sequence — look for BEL terminator
                bel_pos = data.find(OSC_END, i)
                if bel_pos == -1:
                    # No terminator yet — buffer the rest
                    self._osc_body += data[i:]
                    i = len(data)
                else:
                    self._osc_body += data[i:bel_pos]
                    self._in_osc = False
                    i = bel_pos + 1

                    # Check if this is our command prefix
                    if self._osc_body.startswith(OSC_COMMAND_PREFIX):
                        json_str = self._osc_body[len(OSC_COMMAND_PREFIX):]
                        try:
                            cmd = json.loads(json_str)
                            commands.append(cmd)
                        except json.JSONDecodeError:
                            # Malformed — pass it through as text so user sees it
                            text_parts.append(
                                OSC_START + self._osc_body + OSC_END
                            )
                    else:
                        # Not our OSC — pass through unchanged
                        text_parts.append(
                            OSC_START + self._osc_body + OSC_END
                        )
                    self._osc_body = ""
            else:
                # Look for the start of an OSC sequence
                esc_pos = data.find(OSC_START, i)
                if esc_pos == -1:
                    # No escape in remaining data — all passthrough
                    text_parts.append(data[i:])
                    i = len(data)
                else:
                    # Everything before the escape is passthrough
                    if esc_pos > i:
                        text_parts.append(data[i:esc_pos])
                    self._in_osc = True
                    self._osc_body = ""
                    i = esc_pos + len(OSC_START)

        passthrough = "".join(text_parts)
        return passthrough, commands


# ---------------------------------------------------------------------------
# PTY -> Chrome: read PTY output, extract commands, forward to extension
# ---------------------------------------------------------------------------

def pty_to_chrome(master_fd: int, parser: OSCParser, shutdown_event: threading.Event) -> None:
    """
    Reader thread: continuously reads from the PTY master fd,
    extracts OSC 7701 commands, and sends them to Chrome.
    Non-command output is forwarded as pty_output messages.
    """
    while not shutdown_event.is_set():
        try:
            ready, _, _ = select.select([master_fd], [], [], 0.1)
            if not ready:
                continue

            raw = os.read(master_fd, PTY_READ_SIZE)
            if not raw:
                break

            data = raw.decode("utf-8", errors="replace")
            passthrough, commands = parser.feed(data)

            # Forward any passthrough terminal output
            if passthrough:
                send_message({
                    "type": "pty_output",
                    "data": passthrough,
                })

            # Forward extracted tool calls
            for cmd in commands:
                request_id = cmd.get("id", "unknown")
                tool = cmd.get("tool", "unknown")
                args = cmd.get("args", {})
                send_message({
                    "type": "tool_call",
                    "requestId": request_id,
                    "tool": tool,
                    "args": args,
                })

        except OSError:
            # PTY closed
            break
        except Exception:
            # Don't crash the reader on transient errors
            continue

    # Signal that the PTY is gone
    if not shutdown_event.is_set():
        try:
            send_message({"type": "pty_closed"})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Chrome -> PTY: handle messages from the extension
# ---------------------------------------------------------------------------

def chrome_to_pty(master_fd: int, msg: dict) -> None:
    """
    Handle a single message from the Chrome extension and write to the PTY.

    Message types:
      - tool_response: format as OSC 7702 and write to PTY.
        If the serialized result exceeds 16 KB, write to a temp file instead.
      - pty_input: write raw keystrokes / text to the PTY.
      - execute_shell: run a command silently and return result via messaging.
    """
    msg_type = msg.get("type", "")

    if msg_type == "tool_response":
        request_id = msg.get("requestId", "unknown")
        ok = msg.get("success", False)
        result = msg.get("result", None)
        error = msg.get("error", None)

        # Build the response envelope
        response: dict = {"id": request_id, "ok": ok}

        if ok:
            response["result"] = result
        else:
            response["error"] = error or "Unknown error"

        serialized = json.dumps(response, separators=(",", ":"))

        if len(serialized) > LARGE_PAYLOAD_THRESHOLD:
            # Write to temp file
            os.makedirs(TEMP_DIR, exist_ok=True)
            filename = f"result_{request_id}.json"
            filepath = os.path.join(TEMP_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(serialized)
            # Send a compact pointer instead
            pointer = json.dumps(
                {"id": request_id, "ok": ok, "file": filepath},
                separators=(",", ":"),
            )
            osc_seq = f"{OSC_START}{OSC_RESPONSE_PREFIX}{pointer}{OSC_END}"
        else:
            osc_seq = f"{OSC_START}{OSC_RESPONSE_PREFIX}{serialized}{OSC_END}"

        try:
            os.write(master_fd, osc_seq.encode("utf-8"))
        except OSError:
            pass # PTY closed or blocked

    elif msg_type == "pty_input":
        data = msg.get("data", "")
        if data:
            try:
                os.write(master_fd, data.encode("utf-8"))
            except OSError:
                pass # PTY closed or blocked

    elif msg_type == "execute_shell":
        request_id = msg.get("requestId")
        command = msg.get("command")
        
        def run_shell():
            try:
                proc = subprocess.Popen(
                    ["/bin/bash", "-c", command],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    preexec_fn=os.setsid
                )
                supervisor.add_process(proc)
                stdout, stderr = proc.communicate(timeout=30)
                send_message({
                    "type": "tool_response",
                    "requestId": request_id,
                    "success": proc.returncode == 0,
                    "result": {
                        "stdout": stdout,
                        "stderr": stderr,
                        "exitCode": proc.returncode
                    }
                })
            except subprocess.TimeoutExpired:
                send_message({
                    "type": "tool_response",
                    "requestId": request_id,
                    "success": False,
                    "error": "Command timed out after 30s"
                })
            except Exception as e:
                send_message({
                    "type": "tool_response",
                    "requestId": request_id,
                    "success": False,
                    "error": str(e)
                })

        threading.Thread(target=run_shell, daemon=True).start()

    elif msg_type == "resize":
        # Optional: handle terminal resize
        rows = msg.get("rows", 24)
        cols = msg.get("cols", 80)
        try:
            import fcntl
            import termios
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except Exception:
            pass

    elif msg_type == "ping":
        send_message({"type": "pong", "ts": time.time()})


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

_cleanup_done = False


def cleanup(child_pid: Optional[int] = None) -> None:
    """Remove temp files and terminate child process."""
    global _cleanup_done
    if _cleanup_done:
        return
    _cleanup_done = True

    # Terminate child shell
    if child_pid:
        try:
            os.killpg(os.getpgid(child_pid), signal.SIGTERM)
        except (OSError, ProcessLookupError):
            pass

    # Terminate background processes
    supervisor.terminate_all()

    # Clean up temp directory
    if os.path.isdir(TEMP_DIR):
        try:
            shutil.rmtree(TEMP_DIR, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    # Ensure temp directory exists
    os.makedirs(TEMP_DIR, exist_ok=True)

    # Determine shell
    shell = os.environ.get("SHELL", "/bin/zsh")

    # Open a PTY pair
    master_fd, slave_fd = pty.openpty()

    # Capture the user's full shell environment.
    # Chrome launches native hosts with a minimal env, so we run login
    # and interactive login shells, merge results, and strip prompt noise.
    import re
    def _strip_esc(s):
        return re.sub(r'\x1b[\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|\x07', '', s)

    def _parse_env(output):
        return dict(
            line.split("=", 1)
            for line in _strip_esc(output).strip().split("\n")
            if "=" in line and not line.startswith("_=")
        )

    seed = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": os.path.expanduser("~"),
        "USER": os.environ.get("USER", ""),
        "SHELL": shell,
        "TERM": "dumb",
    }
    try:
        # Login shell: clean PATH from .zprofile
        r1 = subprocess.run([shell, "-l", "-c", "printenv"],
                            capture_output=True, text=True, timeout=5, env=seed)
        # Interactive login: .zshrc vars (API keys, custom vars)
        r2 = subprocess.run([shell, "-li", "-c", "printenv"],
                            capture_output=True, text=True, timeout=5, env=seed)
        # Merge: interactive fills gaps, login wins for shared keys (cleaner PATH)
        env = {**_parse_env(r2.stdout), **_parse_env(r1.stdout)}
    except Exception:
        env = os.environ.copy()

    # Fill in session vars that macOS injects but shells don't export
    if "TMPDIR" not in env:
        env["TMPDIR"] = tempfile.gettempdir()
    if "SSH_AUTH_SOCK" not in env:
        try:
            r = subprocess.run(["launchctl", "getenv", "SSH_AUTH_SOCK"],
                               capture_output=True, text=True, timeout=2)
            if r.stdout.strip():
                env["SSH_AUTH_SOCK"] = r.stdout.strip()
        except Exception:
            pass

    # Overlay Floyd-specific vars
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["LANG"] = "en_US.UTF-8"
    env["FLOYD_TTY_BRIDGE"] = "4.0"
    env["FLOYD_TOOLS_AVAILABLE"] = "1"
    env["FLOYD_TOOLS_SDK"] = "/usr/local/share/floyd/floyd-tools.sh"

    child = subprocess.Popen(
        [shell, "-l"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        preexec_fn=os.setsid,
        env=env,
    )

    # Close the slave fd in the parent — the child owns it now
    os.close(slave_fd)

    # Register cleanup
    atexit.register(cleanup, child.pid)

    def sigterm_handler(_sig, _frame):
        cleanup(child.pid)
        sys.exit(0)

    signal.signal(signal.SIGTERM, sigterm_handler)
    signal.signal(signal.SIGINT, sigterm_handler)

    # Announce readiness
    send_message({
        "type": "ready",
        "version": "4.0",
        "pid": child.pid,
        "shell": shell,
    })

    # Start the PTY reader thread
    parser = OSCParser()
    shutdown_event = threading.Event()

    reader_thread = threading.Thread(
        target=pty_to_chrome,
        args=(master_fd, parser, shutdown_event),
        daemon=True,
    )
    reader_thread.start()

    # Watchdog thread: reaps finished background processes
    def watchdog():
        while not shutdown_event.is_set():
            supervisor.check_zombies()
            time.sleep(5)
    
    threading.Thread(target=watchdog, daemon=True).start()

    # Main loop: read messages from Chrome, dispatch to PTY
    try:
        while True:
            msg = read_message()
            if msg is None:
                # Chrome disconnected (EOF)
                break
            
            if msg: # Only process if not an empty dict (which means no data ready)
                chrome_to_pty(master_fd, msg)

            # Check if child is still alive
            if child.poll() is not None:
                send_message({
                    "type": "pty_exited",
                    "exitCode": child.returncode,
                })
                break
    except Exception:
        pass
    finally:
        shutdown_event.set()
        reader_thread.join(timeout=2)
        try:
            os.close(master_fd)
        except OSError:
            pass
        cleanup(child.pid)


if __name__ == "__main__":
    main()
