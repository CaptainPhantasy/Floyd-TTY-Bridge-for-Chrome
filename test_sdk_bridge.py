import subprocess
import json
import struct
import time
import os
import threading

proc = subprocess.Popen(
    ["python3", "extension/native_host.py"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)

def read_msg():
    try:
        len_bytes = proc.stdout.read(4)
        if not len_bytes or len(len_bytes) < 4:
            return None
        msg_len = struct.unpack("I", len_bytes)[0]
        data = proc.stdout.read(msg_len)
        return json.loads(data.decode("utf-8"))
    except:
        return None

def reader():
    while True:
        msg = read_msg()
        if not msg: break

        # If the PTY sends a tool call (like floyd_analyze_page asking Chrome)
        if msg.get("type") == "tool_call":
            print(f"PTY requested tool: {msg['tool']} with args {msg.get('args')}")
            # Mock Chrome's response back to the PTY
            mock_response = {
                "type": "tool_response",
                "requestId": msg["requestId"],
                "success": True,
                "result": {"mock": "data", "status": "Simulated Chrome Response"}
            }
            send_msg(mock_response)
        elif msg.get("type") == "pty_output":
            print(f"PTY OUT: {repr(msg['data'])}")

t = threading.Thread(target=reader)
t.daemon = True
t.start()

def send_msg(msg):
    data = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    proc.stdin.write(struct.pack("I", len(data)))
    proc.stdin.write(data)
    proc.stdin.flush()

time.sleep(1)

# Send the command to source the SDK and run a tool
cmd = "source extension/floyd-tools.sh && floyd_analyze_page\r"
send_msg({"type": "pty_input", "data": cmd})

time.sleep(3)
proc.terminate()
