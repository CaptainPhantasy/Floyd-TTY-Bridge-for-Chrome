#!/bin/bash
export FLOYD_TTY_BRIDGE="4.0"
export FLOYD_TOOLS_AVAILABLE="1"
export FLOYD_TOOLS_SDK="$HOME/.floyd/floyd-tools.sh"

source "$FLOYD_TOOLS_SDK"

echo "Agent Bridge Active. Requesting Tom's analysis..."
response=$(floyd_analyze_page)

echo "Tom replied:"
echo "$response" | grep -o '"score":[^,]*' || echo "No score parsed."
