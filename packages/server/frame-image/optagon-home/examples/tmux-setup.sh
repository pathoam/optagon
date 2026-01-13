#!/bin/bash
# Example tmux setup script for Optagon frames
# Copy this to your project: .optagon/tmux-setup.sh
#
# This script runs at frame startup and configures your tmux windows.
# Arguments:
#   $1 = tmux socket path
#   $2 = session name

SOCKET="$1"
SESSION="$2"

# Helper function to run tmux commands
tm() {
    tmux -S "$SOCKET" "$@"
}

# Example: 3-window setup for a typical dev project
# Window 0: shell (already created by startup)
# Window 1: agent (opencode with session restore)
# Window 2: dev server

# Rename first window
tm rename-window -t "$SESSION:0" "shell"

# Create agent window with OpenCode
tm new-window -t "$SESSION" -n "agent"
# Start OpenCode - sessions persist in .agent-data/ and can be restored with /sessions
tm send-keys -t "$SESSION:agent" "opencode" Enter

# Create server window (don't start anything - let agent do it)
tm new-window -t "$SESSION" -n "server"
tm send-keys -t "$SESSION:server" "# Run your dev server here: npm run dev" Enter

# Go back to agent window (most common starting point)
tm select-window -t "$SESSION:agent"

# ============================================
# Session Restoration Tips
# ============================================
# OpenCode sessions are persisted in /workspace/.agent-data/opencode/
#
# To restore a session manually:
#   1. Start opencode
#   2. Type /sessions
#   3. Select the session to restore
#
# To auto-restore the most recent session (advanced):
# LATEST_SESSION=$(ls -t /workspace/.agent-data/opencode/share/storage/session/ 2>/dev/null | head -1)
# if [ -n "$LATEST_SESSION" ]; then
#     tm send-keys -t "$SESSION:agent" "opencode --resume $LATEST_SESSION" Enter
# fi

# ============================================
# Alternative setups
# ============================================

# For Claude Code instead of OpenCode:
# tm send-keys -t "$SESSION:agent" "claude" Enter

# For a project with docker-compose:
# tm new-window -t "$SESSION" -n "docker"
# tm send-keys -t "$SESSION:docker" "docker compose up" Enter

# For Tilt:
# tm new-window -t "$SESSION" -n "tilt"
# tm send-keys -t "$SESSION:tilt" "tilt up" Enter

# Split panes example (agent + logs side by side):
# tm split-window -t "$SESSION:agent" -h -p 30
# tm send-keys -t "$SESSION:agent.1" "tail -f /workspace/logs/app.log" Enter
