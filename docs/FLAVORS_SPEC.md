# Optagon Flavors System - Design Specification

> Specialized frame images for different development stacks

---

## Motivation

The base `optagon/frame:latest` image includes core tools but can't include everything. Different projects need different stacks:

- **Web frontend** → Next.js, Tailwind, testing libraries
- **Backend API** → Database clients, ORMs, API testing tools
- **ML/AI** → PyTorch, Jupyter, CUDA support
- **Blockchain** → Rust, Solana CLI, Anchor framework
- **Mobile** → React Native, Flutter, emulators

Rather than one bloated image or manual setup each time, **flavors** provide pre-configured images for common stacks.

---

## Architecture

### Image Hierarchy

```
optagon/frame:base
├── optagon/frame:node          (Node.js focused)
│   ├── optagon/frame:nextjs    (Next.js + React)
│   ├── optagon/frame:express   (Express + API tools)
│   └── optagon/frame:fullstack (Next.js + Prisma + Postgres)
├── optagon/frame:python        (Python focused)
│   ├── optagon/frame:django    (Django + DRF)
│   ├── optagon/frame:fastapi   (FastAPI + async)
│   └── optagon/frame:ml        (PyTorch + Jupyter)
├── optagon/frame:rust          (Rust focused)
│   └── optagon/frame:solana    (Solana + Anchor)
└── optagon/frame:go            (Go focused)
```

### Base Image Contents

`optagon/frame:base` (current `latest`):
- Ubuntu 24.04
- tmux, zsh
- Node.js 22, Bun, pnpm
- Python 3, pip3
- Git, ripgrep, fd, jq
- Playwright + Chromium
- browser-mcp
- OpenCode, Claude Code CLI

### Flavor Additions

Each flavor extends base with stack-specific tools:

| Flavor | Additions |
|--------|-----------|
| `nextjs` | create-next-app, Tailwind CSS, shadcn/ui CLI, Vercel CLI |
| `fullstack` | Above + Prisma, PostgreSQL client, Redis client |
| `express` | Express generator, REST client tools, JWT utils |
| `django` | Django, Django REST framework, Celery |
| `fastapi` | FastAPI, uvicorn, SQLAlchemy, Alembic |
| `ml` | PyTorch, Jupyter Lab, pandas, numpy, matplotlib, tensorboard |
| `solana` | Rust, Solana CLI, Anchor, SPL tools |
| `go` | Go 1.22+, common Go tools (golangci-lint, air) |

---

## File Structure

```
/home/pta/optagon/optagon-server/
├── frame-image/
│   ├── base/
│   │   ├── Dockerfile           # Base image
│   │   ├── AGENT_CONTEXT.md     # Base agent context
│   │   └── browser-mcp/         # Browser automation
│   │
│   └── flavors/
│       ├── flavors.yaml         # Flavor definitions
│       │
│       ├── nextjs/
│       │   ├── Dockerfile       # FROM optagon/frame:base
│       │   ├── AGENT_CONTEXT.md # Stack-specific context
│       │   └── setup.sh         # Post-create setup
│       │
│       ├── fullstack/
│       │   ├── Dockerfile
│       │   ├── AGENT_CONTEXT.md
│       │   ├── docker-compose.yml  # Postgres, Redis
│       │   └── setup.sh
│       │
│       ├── ml/
│       │   ├── Dockerfile
│       │   ├── AGENT_CONTEXT.md
│       │   └── jupyter_config.py
│       │
│       └── solana/
│           ├── Dockerfile
│           ├── AGENT_CONTEXT.md
│           └── setup.sh
```

---

## Flavor Definition Format

### flavors.yaml

```yaml
flavors:
  nextjs:
    name: "Next.js Development"
    description: "React/Next.js with Tailwind and modern tooling"
    extends: base
    image: optagon/frame:nextjs

    # Stack-specific context for agents
    context:
      stack: "Next.js 14, React 18, Tailwind CSS"
      dev_server: "npm run dev (port 3000)"
      build: "npm run build"
      test: "npm test"

    # Tools pre-installed
    tools:
      - create-next-app
      - tailwindcss
      - shadcn-ui
      - vercel

    # Default port mapping
    ports:
      - 3000:3000

    # Post-init commands (optional)
    init_commands:
      - "npm install"

  fullstack:
    name: "Full-Stack Development"
    description: "Next.js + Prisma + PostgreSQL + Redis"
    extends: nextjs  # Inherits from nextjs
    image: optagon/frame:fullstack

    context:
      stack: "Next.js, Prisma ORM, PostgreSQL, Redis"
      database: "PostgreSQL on localhost:5432"
      cache: "Redis on localhost:6379"

    tools:
      - prisma
      - psql
      - redis-cli

    # Additional services (sidecar containers)
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: optagon
          POSTGRES_PASSWORD: optagon
          POSTGRES_DB: app
        ports:
          - 5432:5432
      redis:
        image: redis:7
        ports:
          - 6379:6379

  ml:
    name: "Machine Learning"
    description: "PyTorch, Jupyter, data science stack"
    extends: base
    image: optagon/frame:ml

    context:
      stack: "PyTorch 2.x, Jupyter Lab, pandas, numpy"
      jupyter: "jupyter lab --port 8888"
      gpu: "CUDA available if host has GPU"

    tools:
      - pytorch
      - jupyter
      - pandas
      - numpy
      - matplotlib
      - tensorboard

    ports:
      - 8888:8888  # Jupyter
      - 6006:6006  # TensorBoard

    # GPU passthrough (if available)
    gpu: optional

  solana:
    name: "Solana Development"
    description: "Rust + Solana CLI + Anchor framework"
    extends: base
    image: optagon/frame:solana

    context:
      stack: "Rust, Solana CLI, Anchor"
      local_validator: "solana-test-validator"
      deploy: "anchor deploy"

    tools:
      - rustc
      - cargo
      - solana-cli
      - anchor
      - spl-token

    ports:
      - 8899:8899  # Solana RPC
      - 8900:8900  # Solana WS
```

---

## CLI Integration

### Commands

```bash
# List available flavors
optagon flavors

# Build a specific flavor
optagon build --flavor nextjs

# Build all flavors
optagon build --all-flavors

# Init with flavor
optagon init --flavor nextjs

# Init with flavor and sidecar services
optagon init --flavor fullstack --with-services
```

### Flavor Selection Flow

```
$ optagon init

? Select a flavor:
  ○ base (Core tools only)
  ● nextjs (Next.js + React + Tailwind)
  ○ fullstack (Next.js + Prisma + PostgreSQL)
  ○ ml (PyTorch + Jupyter)
  ○ solana (Rust + Solana + Anchor)
  ○ custom (Specify Dockerfile)

Creating frame with flavor 'nextjs'...
```

---

## Agent Context per Flavor

Each flavor has its own `AGENT_CONTEXT.md` that extends the base:

### Example: nextjs/AGENT_CONTEXT.md

```markdown
# Optagon Frame: Next.js Development

## Stack
- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- TypeScript

## Quick Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server (port 3000) |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests |
| `npx shadcn-ui add [component]` | Add shadcn component |

## Project Structure (typical)
```
/workspace/
├── app/              # App Router pages
│   ├── layout.tsx
│   ├── page.tsx
│   └── api/          # API routes
├── components/       # React components
├── lib/              # Utilities
├── public/           # Static assets
└── tailwind.config.js
```

## Development Workflow

1. Start dev server: `npm run dev`
2. View at: http://localhost:3000 (or mapped port)
3. Use browser_screenshot() to verify UI changes
4. Hot reload is enabled - changes reflect immediately

## Common Tasks

### Add a new page
Create `app/[route]/page.tsx`

### Add a component
```bash
npx shadcn-ui add button
```

### Add API route
Create `app/api/[route]/route.ts`

## Tips for AI Agents
- Use Tailwind classes for styling (no separate CSS files)
- Prefer Server Components unless client interactivity needed
- Use `"use client"` directive for client components
- Check `/workspace/components/ui/` for available shadcn components
```

---

## Sidecar Services

For flavors like `fullstack` that need databases:

### Service Management

```bash
# Start frame with services
optagon start myproject  # Auto-starts postgres, redis

# Check service status
optagon services myproject

# Restart a service
optagon services myproject restart postgres

# View service logs
optagon services myproject logs postgres
```

### Implementation

Services run as additional Podman containers in a pod:

```bash
# Creates a pod with all containers
podman pod create --name optagon-myproject \
  -p 33000:3000 \
  -p 33001:5432 \
  -p 33002:6379

# Main frame container
podman run -d --pod optagon-myproject \
  --name optagon-frame-myproject \
  optagon/frame:fullstack

# Postgres sidecar
podman run -d --pod optagon-myproject \
  --name optagon-myproject-postgres \
  -e POSTGRES_USER=optagon \
  postgres:16

# Redis sidecar
podman run -d --pod optagon-myproject \
  --name optagon-myproject-redis \
  redis:7
```

Within the pod, containers can reach each other via `localhost`.

---

## Build System

### Building Flavors

```bash
# Build base first
optagon build --flavor base

# Build specific flavor (auto-builds dependencies)
optagon build --flavor fullstack
# This builds: base → nextjs → fullstack

# Build all
optagon build --all-flavors
```

### Build Order

The system resolves the dependency graph:

```
base
├── nextjs (depends on base)
│   └── fullstack (depends on nextjs)
├── python (depends on base)
│   ├── django (depends on python)
│   ├── fastapi (depends on python)
│   └── ml (depends on python)
├── rust (depends on base)
│   └── solana (depends on rust)
└── go (depends on base)
```

---

## Implementation Phases

### Phase A: Core Flavor System
1. Restructure Dockerfile to `frame-image/base/`
2. Create `flavors.yaml` schema and parser
3. Add `optagon flavors` command
4. Add `--flavor` flag to `init` and `build`
5. Create 2-3 initial flavors (nextjs, ml, solana)

### Phase B: Agent Context Integration
1. Per-flavor `AGENT_CONTEXT.md` files
2. Merge base + flavor context at runtime
3. Auto-detect project type and suggest flavor
4. Context injection into agent system prompts

### Phase C: Sidecar Services
1. Pod-based container orchestration
2. Service lifecycle management
3. Service health checks
4. Log aggregation

### Phase D: Custom Flavors
1. User-defined flavors in `~/.optagon/flavors/`
2. Flavor inheritance from any base
3. Flavor sharing/export

---

## Example Dockerfiles

### frame-image/flavors/nextjs/Dockerfile

```dockerfile
FROM optagon/frame:base

# Next.js global tools
RUN npm install -g create-next-app vercel

# Tailwind and UI tools
RUN npm install -g tailwindcss postcss autoprefixer
RUN npm install -g @shadcn/ui

# Update agent context
COPY AGENT_CONTEXT.md /opt/optagon/flavors/nextjs/
RUN cat /opt/optagon/AGENT_CONTEXT.md /opt/optagon/flavors/nextjs/AGENT_CONTEXT.md > /opt/optagon/AGENT_CONTEXT_FULL.md && \
    mv /opt/optagon/AGENT_CONTEXT_FULL.md /opt/optagon/AGENT_CONTEXT.md
```

### frame-image/flavors/ml/Dockerfile

```dockerfile
FROM optagon/frame:base

# Python ML stack
RUN pip3 install --break-system-packages \
    torch \
    torchvision \
    jupyter \
    jupyterlab \
    pandas \
    numpy \
    matplotlib \
    seaborn \
    scikit-learn \
    tensorboard

# Jupyter config
COPY jupyter_config.py /root/.jupyter/jupyter_lab_config.py

# Expose Jupyter port
EXPOSE 8888

# Update agent context
COPY AGENT_CONTEXT.md /opt/optagon/flavors/ml/
RUN cat /opt/optagon/AGENT_CONTEXT.md /opt/optagon/flavors/ml/AGENT_CONTEXT.md > /tmp/combined.md && \
    mv /tmp/combined.md /opt/optagon/AGENT_CONTEXT.md
```

---

## Summary

The flavors system provides:

1. **Pre-configured stacks** - No manual setup for common tech
2. **Optimized images** - Only install what you need
3. **Agent awareness** - Context tailored to the stack
4. **Service orchestration** - Databases, caches as sidecars
5. **Extensibility** - Create custom flavors

This builds on Phase 1's foundation while setting up for Phase 2's context/knowledge management.
