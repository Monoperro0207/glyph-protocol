# Integration test sandbox: Hermes Agent + DeepSeek + Glyph Protocol.
#
# Two services run inside this image, coordinated by docker-entrypoint.sh:
#   1. glyph server (Node, tsx) on 127.0.0.1:3199
#   2. hermes agent + the Glyph→MCP bridge (Python + Node mixed)
#
# Native Python test runs separately under the same image via:
#   docker compose run --rm sandbox native-test
FROM node:20-bookworm-slim

# Hermes' install.sh wants: python 3.11, uv, ripgrep, git, ffmpeg, curl.
# Plus build-essential for any python deps with C extensions.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      ripgrep git ffmpeg curl ca-certificates build-essential \
      sqlite3 && \
    rm -rf /var/lib/apt/lists/*

# pnpm (matches the host repo's package manager pin)
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

# uv (Hermes' installer uses it for fast Python env management)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && \
    ln -s /root/.local/bin/uv /usr/local/bin/uv

WORKDIR /app

# Copy the monorepo into the image. The .dockerignore filters node_modules
# so we get a clean install inside the container.
COPY . /app

# Build every workspace package. Examples/05 picks up its workspace deps.
RUN pnpm install --frozen-lockfile --config.confirmModulesPurge=false || \
    pnpm install --config.confirmModulesPurge=false
RUN pnpm -r --filter './packages/*' --filter './packages/adapters/*' build

# Python venv for the native test
RUN python3 -m venv /opt/glyph-pyenv && \
    /opt/glyph-pyenv/bin/pip install --no-cache-dir -r examples/05-hermes-integration/native-test/requirements.txt

# Skip the Hermes installer — we install hermes-agent via pip inside the
# Python venv directly. The installer baked too many interactive prompts
# for a non-TTY container run. This is the equivalent manual path the
# Hermes README documents under "Quick start for contributors".
RUN git clone --depth=1 https://github.com/NousResearch/hermes-agent.git /opt/hermes-agent && \
    /opt/glyph-pyenv/bin/pip install --no-cache-dir -e "/opt/hermes-agent[all]" || \
    /opt/glyph-pyenv/bin/pip install --no-cache-dir -e "/opt/hermes-agent"

ENV PATH="/opt/glyph-pyenv/bin:${PATH}"
ENV GLYPH_SERVER_URL=http://127.0.0.1:3199
ENV WORKSPACE_ROOT=/app/examples/05-hermes-integration/workspace

WORKDIR /app/examples/05-hermes-integration

COPY examples/05-hermes-integration/scripts/docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["all"]
