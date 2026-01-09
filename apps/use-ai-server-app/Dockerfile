# Multi-stage build for use-ai-server-app
# This Dockerfile is designed to run from the monorepo root

# Build argument for version (passed from CI or defaults to dev)
ARG VERSION=dev

FROM oven/bun:1.3.2-slim AS base
WORKDIR /app

# Install dependencies stage
FROM base AS install
# Copy ALL workspace package.json files for correct dependency resolution
# (these won't be in the final image - only needed for lockfile resolution)
COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/
COPY packages/plugin-workflows/package.json ./packages/plugin-workflows/
COPY packages/plugin-mastra/package.json ./packages/plugin-mastra/
COPY apps/use-ai-server-app/package.json ./apps/use-ai-server-app/
COPY apps/example/package.json ./apps/example/
COPY apps/example-nest-mcp-server/package.json ./apps/example-nest-mcp-server/

# Install all dependencies including devDependencies (needed for build)
# Skip postinstall script (creates .env symlinks not needed in Docker)
RUN bun install --frozen-lockfile --ignore-scripts

# Build stage
FROM base AS build
# Copy installed dependencies from install stage
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=install /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=install /app/packages/plugin-workflows/node_modules ./packages/plugin-workflows/node_modules
COPY --from=install /app/apps/use-ai-server-app/node_modules ./apps/use-ai-server-app/node_modules

# Copy source files
COPY package.json bun.lock turbo.json tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/server ./packages/server
COPY packages/plugin-workflows ./packages/plugin-workflows
COPY apps/use-ai-server-app ./apps/use-ai-server-app

# Build all packages
RUN bun run build

# Production stage
FROM oven/bun:1.3.2-slim AS production

# Re-declare ARG after FROM to make it available
ARG VERSION=dev

WORKDIR /app

# Copy only necessary runtime files
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules

# Copy built core package
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/node_modules ./packages/core/node_modules

# Copy built server package
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/server/node_modules ./packages/server/node_modules

# Copy built plugin-workflows package
COPY --from=build /app/packages/plugin-workflows/dist ./packages/plugin-workflows/dist
COPY --from=build /app/packages/plugin-workflows/package.json ./packages/plugin-workflows/
COPY --from=build /app/packages/plugin-workflows/node_modules ./packages/plugin-workflows/node_modules

# Copy built server app
COPY --from=build /app/apps/use-ai-server-app/dist ./apps/use-ai-server-app/dist
COPY --from=build /app/apps/use-ai-server-app/package.json ./apps/use-ai-server-app/

# Set up non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 bunuser && \
    chown -R bunuser:nodejs /app

USER bunuser

# Expose default port
EXPOSE 8081

# ============================================================================
# IMAGE METADATA (OCI Labels)
# ============================================================================
LABEL org.opencontainers.image.title="UseAI Server" \
      org.opencontainers.image.description="Batteries-included server for use with `use-ai` framework." \
      org.opencontainers.image.vendor="Meetsmore" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/meetsmore/use-ai" \
      org.opencontainers.image.documentation="https://github.com/meetsmore/use-ai/blob/main/README.md" \
      maintainer="zachary.davison@meetsmore.com"

# Configuration documentation labels
LABEL config.env.required.anthropic_api_key="Anthropic Claude API key (required if openai_api_key not set)" \
      config.env.required.openai_api_key="OpenAI GPT API key (required if anthropic_api_key not set)" \
      config.env.optional.anthropic_model="Claude model (default: claude-sonnet-4-20250514)" \
      config.env.optional.openai_model="OpenAI model (default: gpt-4-turbo)" \
      config.env.optional.port="Server port (default: 8081)" \
      config.env.optional.log_format="Log format: pretty|json (default: json)" \
      config.env.optional.rate_limit_max_requests="Max requests per window, 0=unlimited (default: 0)" \
      config.env.optional.rate_limit_window_ms="Rate limit window in ms (default: 60000)" \
      config.env.optional.langfuse_public_key="Langfuse public key for observability" \
      config.env.optional.langfuse_secret_key="Langfuse secret key for observability" \
      config.env.optional.langfuse_base_url="Langfuse base URL (default: https://cloud.langfuse.com)" \
      config.env.optional.dify_api_url="Dify API base URL for workflow integration" \
      config.env.pattern.dify_workflow_keys="DIFY_<WORKFLOW>_KEY for workflow-specific API keys" \
      config.env.pattern.mcp_endpoints="MCP_ENDPOINT_<NAME>_URL/NAMESPACE/TIMEOUT for MCP servers"

# --- Server Configuration ---
ENV NODE_ENV=production
ENV PORT=8081
ENV LOG_FORMAT=json

# Health check - verify Socket.IO server is responding
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD bun -e "import {connect} from 'socket.io-client'; const socket = connect('http://localhost:' + (process.env.PORT || 8081)); socket.on('connect', () => { socket.close(); process.exit(0); }); socket.on('connect_error', () => { socket.close(); process.exit(1); }); setTimeout(() => { socket.close(); process.exit(1); }, 2000);"

# Run the server
CMD ["bun", "run", "/app/apps/use-ai-server-app/dist/index.js"]
