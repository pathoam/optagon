# Optagon

Personal software development server with isolated frames.

## What is Optagon?

Optagon manages isolated development environments called "frames". Each frame is a containerized workspace with:

- Full dev environment (Node.js, Python, etc.)
- Terminal access via tmux
- Browser automation for visual feedback
- Automatic port mapping for dev servers

## Quick Start

```bash
# Install dependencies
bun install

# Create a frame
bun run packages/server/src/index.ts frame create my-project --workspace ~/projects/my-app

# Start the frame
bun run packages/server/src/index.ts frame start my-project

# Attach to the frame's terminal
bun run packages/server/src/index.ts frame attach my-project
```

## Packages

| Package | Description |
|---------|-------------|
| `@optagon/server` | Core server, frame lifecycle, container management |

## Documentation

- [Architecture Spec](docs/OPTAGON_SPEC.md)
- [Tunnel Spec](docs/tunnel-spec.md) - Expose frames to internet via optagon.ai

## License

MIT
