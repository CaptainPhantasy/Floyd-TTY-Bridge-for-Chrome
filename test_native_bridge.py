import sys
import json
import struct
import os

def send_message(msg):
    serialized = json.dumps(msg, separators=(",", ":"))
    sys.stdout.buffer.write(struct.pack("@I", len(serialized)))
    sys.stdout.buffer.write(serialized.encode("utf-8"))
    sys.stdout.buffer.flush()

# This is what Chrome sends when you type 'ls' + Enter
send_message({"type": "pty_input", "data": "ls\r"})
send_message({"type": "pty_input", "data": "echo 'IT WORKS'\r"})
