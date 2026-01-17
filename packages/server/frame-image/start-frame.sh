#!/bin/bash
# Optagon Frame Startup Script
# Creates tmux session and optionally runs workspace-specific setup

SOCKET_PATH="/run/optagon/tmux.sock"
SESSION_NAME="main"

# Create .optagon/ config directory with docs symlink
# User can add their own files (tmux-setup.sh, etc.)
mkdir -p /workspace/.optagon
if [ ! -e "/workspace/.optagon/docs" ]; then
    ln -s /opt/optagon /workspace/.optagon/docs
fi

# ============================================
# Agent Data Persistence
# ============================================
# Persist OpenCode sessions/history across container restarts
# Data stored in /workspace/.agent-data/ (survives restarts)

AGENT_DATA="/workspace/.agent-data"
mkdir -p "$AGENT_DATA/opencode/share" "$AGENT_DATA/opencode/state"

# Create parent directories
mkdir -p /root/.local/share /root/.local/state

# Symlink OpenCode data directories to persistent storage
if [ ! -L "/root/.local/share/opencode" ]; then
    rm -rf /root/.local/share/opencode 2>/dev/null
    ln -s "$AGENT_DATA/opencode/share" /root/.local/share/opencode
fi

if [ ! -L "/root/.local/state/opencode" ]; then
    rm -rf /root/.local/state/opencode 2>/dev/null
    ln -s "$AGENT_DATA/opencode/state" /root/.local/state/opencode
fi

# Claude Code: credentials may be mounted read-only from host
# Ensure .claude directory exists (credentials file may already be mounted inside)
mkdir -p /root/.claude

# Set up workspace persistence for other Claude data (history, projects, etc.)
mkdir -p "$AGENT_DATA/claude"
for subdir in projects cache debug shell-snapshots todos statsig; do
    if [ ! -e "/root/.claude/$subdir" ]; then
        mkdir -p "$AGENT_DATA/claude/$subdir"
        ln -s "$AGENT_DATA/claude/$subdir" "/root/.claude/$subdir"
    fi
done

if [ -f "/root/.claude/.credentials.json" ]; then
    echo "Using host Claude Code credentials"
fi

# Start tmux session
tmux -S "$SOCKET_PATH" new-session -d -s "$SESSION_NAME" -c /workspace
chmod 777 "$SOCKET_PATH"

# Check for workspace-specific tmux setup
if [ -f "/workspace/.optagon/tmux-setup.sh" ]; then
    # Run custom setup script
    bash /workspace/.optagon/tmux-setup.sh "$SOCKET_PATH" "$SESSION_NAME"
elif [ -f "/workspace/.optagon.yml" ]; then
    # Future: parse YAML config for windows/commands
    # For now, just log it exists
    echo "Found .optagon.yml - custom config support coming soon"
fi

# Keep container running
tail -f /dev/null
