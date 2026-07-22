# Floyd TTY Bridge — Demonstration Procedures

This document outlines the steps to demonstrate the three core use cases of the Floyd TTY Bridge.

## Prerequisites
1.  **Extension Loaded**: Ensure the extension is loaded in Chrome (Developer Mode).
2.  **Native Host Connected**: Open the side panel (Cmd+Shift+Y) and verify the green `[NATIVE HOST CONNECTED]` message.
3.  **SDK Sourced**: In the terminal, run `source floyd-tools.sh`.
4.  **Tom Connected**: Click the "Connect to Tom" button in the side panel.

---

## Use Case 1: Active Co-Development
**Goal**: Demonstrate real-time code editing and automatic browser refresh.

1.  **Navigate**: In the terminal, run `floyd_navigate "https://example.com"`.
2.  **Modify**: Open a local test file (e.g., `test.html`) and make a change.
3.  **Auto-Refresh**: Save the file. Observe the browser tab reloading automatically.
4.  **Manual Refresh**: Run `floyd_refresh` in the terminal. Verify the tab reloads.

---

## Use Case 2: Tom → FLOYD Communication
**Goal**: Demonstrate Tom (Vision) instructing Floyd (Shell) to execute commands.

1.  **Ask Tom**: In the terminal, run `floyd_ask_tom "Analyze this page and suggest a shell command to list the directory."`.
2.  **Tom Instruction**: Tom (Gemini Live) will respond by voice and include a `floyd_command` in the tool result.
3.  **PTY Injection**: Observe the command (e.g., `ls -la`) being automatically typed and executed in your terminal.
4.  **Verification**: Confirm the `[Tom suggested: ...]` message appears in the terminal.

---

## Use Case 3: Cross-Reference Workflow
**Goal**: Demonstrate Floyd and Tom collaborating to verify sales claims against a codebase.

1.  **Load Document**: Open a sales PDF or document in a browser tab.
2.  **Scan Claims**: Tom uses `extract_text` to read a claim (e.g., "Supports OAuth 2.0").
3.  **Search Code**: Floyd runs `grep -r "oauth" ./src` in the terminal to find the implementation.
4.  **Record Result**: Floyd runs:
    ```bash
    floyd_verify_claim "CLAIM-001" "Supports OAuth 2.0" "sales_deck.pdf" "src/auth.ts:42" "verified" "Matches AuthProvider implementation"
    ```
5.  **Verify Log**: Check the side panel for the structured verification report.
