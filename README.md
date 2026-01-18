# Optagon

Personal software development server with isolated frames.

## What is Optagon?

Optagon manages isolated development environments called "frames". Each frame is a containerized workspace with:

- Full dev environment (Node.js, Python, Bun, etc.)
- Terminal access via tmux
- Browser automation for visual feedback
- Automatic port mapping for dev servers
- AI coding agents (Claude Code, OpenCode)

## Prerequisites

- **Bun** >= 1.0.0 - JavaScript runtime
- **Podman** or Docker - Container runtime
- **PostgreSQL** - State storage (can run via podman)

## Quick Start

```bash
# Clone and install
git clone https://github.com/anthropics/optagon.git
cd optagon
bun install

# Start PostgreSQL (uses podman)
cd packages/server
bun run src/index.ts db start

# Build the frame image (first time only)
bun run src/index.ts build

# Check prerequisites
bun run src/index.ts doctor
```

### Create Your First Frame

```bash
# Navigate to your project
cd ~/projects/my-app

# Initialize a frame (creates frame for current directory)
bun run ~/optagon/packages/server/src/index.ts init

# Start the frame
bun run ~/optagon/packages/server/src/index.ts start

# Or with global install:
# optagon init && optagon start
```

### Common Commands

```bash
optagon init [name]     # Initialize frame for current directory
optagon start [name]    # Start frame and attach
optagon stop [name]     # Stop running frame
optagon attach [name]   # Attach to running frame's tmux
optagon list            # List all frames
optagon doctor          # Check system prerequisites
```

## Port Allocation

Optagon automatically allocates ports from range 33000-34000:

| Port Type | Range | Example |
|-----------|-------|---------|
| Dev server | 33000-34000 | `localhost:33001` |
| Tilt UI | hostPort + 2000 | `localhost:35001` |
| Additional | hostPort + 100+ | `localhost:33101` |

## Packages

| Package | Description |
|---------|-------------|
| `@optagon/server` | Core server, frame lifecycle, container management |
| `@optagon/tunnel-server` | Relay server for remote access |
| `@optagon/web` | PWA for mobile/remote access |

## Documentation

- [Architecture Spec](docs/OPTAGON_SPEC.md)
- [Tunnel Spec](docs/tunnel-spec.md) - Expose frames via optagon.app

## Troubleshooting

Run `optagon doctor` to diagnose issues:

```
$ optagon doctor
Preflight Checks

  ✓ Container Runtime    podman available
  ✓ Frame Image          optagon/frame:latest exists
  ✓ tmux                 tmux available
  ✓ script               script available
  ✓ Database             PostgreSQL connected
```

**Common issues:**

- **Database not connected**: Run `optagon db start`
- **Frame image missing**: Run `optagon build`
- **Container runtime missing**: Install podman or docker

## License

MIT
