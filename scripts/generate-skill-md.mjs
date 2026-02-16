#!/usr/bin/env node

/**
 * Generate skills/use-ai/SKILL.md from the TypeDoc docs index.
 *
 * Run via: bun run skill:md
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const docsDir = join(root, "skills", "use-ai", "docs");
const skillFile = join(root, "skills", "use-ai", "SKILL.md");

// Collect all markdown files under the docs directory
function collectMarkdownFiles(dir, prefix = "") {
  const lines = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      lines.push(...collectMarkdownFiles(full, rel));
    } else if (entry.endsWith(".md")) {
      lines.push(`- [${rel}](docs/${rel})`);
    }
  }
  return lines;
}

const docsIndex = existsSync(docsDir)
  ? collectMarkdownFiles(docsDir).join("\n")
  : "_No docs generated yet._";

const skillMd = `---
name: use-ai
description: >
  API reference and architecture guide for the use-ai TypeScript monorepo.
  Use when working with use-ai packages: core, client, server, or plugin-workflows.
  Covers tool definitions (defineTool), useAI/useAIWorkflow hooks, Socket.IO protocol,
  AG-UI events, plugin architecture, and deployment patterns.
---

This skill provides an API reference and architecture guide for use-ai. Do not rely on internal knowledge. Always refer to the reference documents when working with use-ai.

## API Documentation Index

The following auto-generated API docs are available as supporting files.
Read them when you need detailed type signatures, method parameters, or return types.

${docsIndex}
`;

writeFileSync(skillFile, skillMd);
console.log(`Generated ${skillFile}`);
