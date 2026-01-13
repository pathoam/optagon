# Shell & System Tools

Available commands and utilities in this environment.

## Optagon Tools

| Command | Description |
|---------|-------------|
| `browser-tool` | Browser automation (navigate, screenshot, click, etc.) |
| `frame-context` | Print quick environment reference |

See `.optagon/tools/browser/` for full browser-tool docs.

## Languages & Runtimes

| Command | Version | Notes |
|---------|---------|-------|
| `node` | 22.x | Node.js LTS |
| `npm` | latest | Node package manager |
| `npx` | latest | Run npm packages |
| `pnpm` | latest | Fast package manager |
| `bun` | latest | Fast JS/TS runtime |
| `python3` | 3.x | System Python |
| `pip3` | latest | Python packages |

## Package Managers

```bash
# Node.js
npm install                     # Install from package.json
npm install <pkg>               # Add package
npm run <script>                # Run script
npm test                        # Run tests

# pnpm (faster)
pnpm install
pnpm add <pkg>
pnpm run <script>

# Bun (fastest)
bun install
bun add <pkg>
bun run <script>
bun test                        # Built-in test runner

# Python
pip3 install -r requirements.txt
pip3 install <pkg>
python3 -m venv .venv          # Create virtual env
```

## Version Control

```bash
git status                      # Current state
git log --oneline -10           # Recent commits
git diff                        # Unstaged changes
git diff --staged               # Staged changes
git add <file>                  # Stage file
git commit -m "message"         # Commit
git branch                      # List branches
git checkout -b <name>          # New branch
```

## File Operations

```bash
ls -la                          # List with details
cat <file>                      # Show file
head -20 <file>                 # First 20 lines
tail -20 <file>                 # Last 20 lines
less <file>                     # Paginated view
cp <src> <dst>                  # Copy
mv <src> <dst>                  # Move/rename
rm <file>                       # Delete
mkdir -p <path>                 # Create directory
```

## Text Processing

```bash
jq '.'  <file.json>             # Pretty print JSON
jq '.key' <file.json>           # Extract key
jq '.[] | .name' <file.json>    # Map over array

cat file | head -10             # First 10 lines
cat file | tail -10             # Last 10 lines
cat file | wc -l                # Count lines
```

## Network

```bash
curl <url>                      # GET request
curl -X POST <url> -d '{}'      # POST with data
curl -I <url>                   # Headers only
wget <url>                      # Download file

ss -tlnp                        # List listening ports
```

## Process Management

```bash
ps aux                          # All processes
htop                            # Interactive process viewer
kill <pid>                      # Stop process
pkill -f "pattern"              # Kill by name

# Background jobs
command &                       # Run in background
jobs                            # List background jobs
fg                              # Bring to foreground
```

## tmux (you're in it)

```bash
# Prefix is Ctrl+b
Ctrl+b c                        # New window
Ctrl+b n                        # Next window
Ctrl+b p                        # Previous window
Ctrl+b 0-9                      # Go to window N
Ctrl+b d                        # Detach
Ctrl+b [                        # Scroll mode (q to exit)
Ctrl+b x                        # Kill pane
Ctrl+b &                        # Kill window
```

## Environment

```bash
echo $VARIABLE                  # Print variable
export VAR=value                # Set variable
env                             # All variables
which <cmd>                     # Find command path
```

## Disk & System

```bash
df -h                           # Disk usage
du -sh <dir>                    # Directory size
free -h                         # Memory usage
uname -a                        # System info
```

## Quick Checks

```bash
# What's installed?
which node bun python3 git rg fd

# What's running?
ps aux | grep -E "node|python|bun"

# What ports are open?
ss -tlnp | grep LISTEN

# Where am I?
pwd

# What's here?
ls -la
```
