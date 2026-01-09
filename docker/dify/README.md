# Dify Docker Setup for use-ai

This directory contains a standalone Docker Compose setup for running Dify locally for workflow development.

## Quick Start

### 1. Start Dify

```bash
cd docker/dify
docker compose up -d
```

This will start all Dify services including:
- API server
- Worker
- Web UI
- PostgreSQL database
- Redis
- Nginx
- Weaviate vector database

### 2. Initialize Database (First Time Only)

Run database migrations:

```bash
docker compose exec api flask db upgrade
```

This creates all necessary database tables. You only need to do this once on first setup.

### 3. Access Dify

Open your browser and navigate to:
```
http://localhost:3001
```

You'll see the `/install` page. Create an admin account to complete the initial setup.

### 4. Create a Workflow

1. Log in to Dify
2. Click "Studio" → "Create App" → "Workflow"
3. Give your workflow a name (e.g., "greeting-workflow")
4. Add workflow nodes:
   - **Start node**: Define input variables (e.g., `username`)
   - **LLM node**: Use the variables in your prompt
   - **End node**: Define output
5. Publish the workflow

### 5. Get API Key

1. Go to your workflow app in Dify
2. Click "API Access" in the left sidebar
3. Copy the **API Key** (starts with `app-...`)

### 6. Configure use-ai Server

Set environment variables for Dify workflows:

```bash
# Base URL for Dify API
export DIFY_API_URL="http://localhost:3001/v1"

# Map workflow names to API keys using pattern: DIFY_<WORKFLOW_NAME>_KEY
export DIFY_GREETING_WORKFLOW_KEY="app-xxxxx"
export DIFY_PDF_PROCESSOR_KEY="app-yyyyy"
```

**Environment Variable Naming Convention:**
- Pattern: `DIFY_<WORKFLOW_NAME>_KEY=<api-key>`
- The `<WORKFLOW_NAME>` is converted to lowercase with hyphens (e.g., `GREETING_WORKFLOW` → `greeting-workflow`)
- This allows you to use meaningful workflow names in code while keeping API keys in environment variables

### 7. Test the Workflow

Start the use-ai server:
```bash
bun run start:server
```

Start the example app:
```bash
bun run dev
```

Navigate to the Workflow Demo page and test your workflow!

## Creating a Simple Greeting Workflow

Here's how to create a workflow that accepts a `username` input and generates a personalized greeting:

### Workflow Structure

1. **Start Node**
   - Add input variable: `username` (type: Text)

2. **LLM Node**
   - Model: Claude Sonnet 4 (or any model you prefer)
   - System Prompt: "You are a friendly assistant."
   - User Prompt: "Write a nice greeting for {{#start.username#}}"
   - Connect from Start node

3. **End Node**
   - Add output variable: `greeting` (type: Text)
   - Value: `{{#llm.text#}}`
   - Connect from LLM node

4. **Publish** the workflow

### Using Variables in Dify

- Input variables from Start node: `{{#start.variableName#}}`
- LLM output: `{{#llm.text#}}`
- Variables are **properly supported** in Dify workflows (unlike Flowise!)

## Stopping Dify

```bash
cd docker/dify
docker compose down
```

## Troubleshooting

### Port Conflicts

If port 80 is already in use, you can change the exposed port in `docker-compose.yml`:

```yaml
nginx:
  ports:
    - "8081:80"  # Change 80 to 8081 here
```

Then access Dify at `http://localhost:8081` and update `DIFY_API_URL` to `http://localhost:8081/v1`.

### Database Issues

If you need to reset the database:
```bash
docker compose down -v  # Warning: This deletes all data!
docker compose up -d
```

## Learn More

- [Dify Official Documentation](https://docs.dify.ai)
- [Dify GitHub Repository](https://github.com/langgenius/dify)
- [Workflow Development Guide](https://docs.dify.ai/guides/workflow)
