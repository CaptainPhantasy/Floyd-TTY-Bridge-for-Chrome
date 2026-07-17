const { spawn } = require('child_process');
const fs = require('fs');

const agent = spawn('zsh', ['-i'], {
  env: {
    ...process.env,
    FLOYD_TTY_BRIDGE: "4.0",
    FLOYD_TOOLS_AVAILABLE: "1",
    FLOYD_TOOLS_SDK: process.env.HOME + "/.floyd/floyd-tools.sh"
  }
});

let output = '';

agent.stdout.on('data', (data) => {
  const str = data.toString();
  console.log("AGENT OUT:", JSON.stringify(str));
  output += str;
  if (output.includes("ready")) {
    agent.stdin.write('source ~/.floyd/floyd-tools.sh && floyd_analyze_page\n');
    output = ''; // Reset
  }
  if (output.includes("\x1b]7701;")) {
      console.log("SUCCESS: Caught OSC 7701 command from Agent SDK");
  }
});

agent.stderr.on('data', (data) => {
  console.error("AGENT ERR:", JSON.stringify(data.toString()));
});

setTimeout(() => {
    agent.stdin.write('echo ready\n');
}, 500);

setTimeout(() => {
    agent.kill();
    process.exit(0);
}, 3000);
