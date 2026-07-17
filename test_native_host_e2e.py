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

output_msgs = []
def read_msg():
    try:
        len_bytes = proc.stdout.read(4)
        if not len_bytes or len(len_bytes) < 4:
            return None
        msg_len = struct.unpack("I", len_bytes)[0]
        data = proc.stdout.read(msg_len)
        return json.loads(data.decode("utf-8"))
    except Exception as e:
        return None

def reader():
    while True:
        msg = read_msg()
        if msg:
            output_msgs.append(msg)
            print(f"HOST->CHROME: {msg}")
        else:
            break

t = threading.Thread(target=reader)
t.daemon = True
t.start()

def send_msg(msg):
    print(f"CHROME->HOST: {msg}")
    data = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    proc.stdin.write(struct.pack("I", len(data)))
    proc.stdin.write(data)
    proc.stdin.flush()

print("Waiting for boot...")
time.sleep(1)
send_msg({"type": "pty_input", "data": "ls -la\r"})
time.sleep(2)
proc.terminate()
print("Test complete. Messages received:", len(output_msgs))
