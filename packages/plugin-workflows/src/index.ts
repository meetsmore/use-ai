/**
 * Workflows plugin for @meetsmore-oss/use-ai-server.
 * Provides headless workflow execution with pluggable workflow runners.
 */

export { WorkflowsPlugin, type WorkflowsPluginConfig } from './WorkflowsPlugin';
export type { WorkflowRunner, WorkflowInput, WorkflowResult, EventEmitter } from './types';
export { DifyWorkflowRunner, type DifyWorkflowRunnerConfig } from './runners/DifyWorkflowRunner';
