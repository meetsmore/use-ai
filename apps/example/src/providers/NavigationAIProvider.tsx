import React, { ReactNode } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { useRouter } from '../router';

const AVAILABLE_PAGES = [
  { path: '/', label: 'Todo List', description: 'Todo list management — fundamental useAI + defineTool pattern' },
  { path: '/calculator', label: 'Calculator', description: 'Calculator — tool return values sent back to AI' },
  { path: '/combined', label: 'Combined Components', description: 'Multiple useAI hooks composing on a single page' },
  { path: '/multi-list', label: 'Multiple Instances', description: 'id parameter for differentiating multiple component instances' },
  { path: '/client-tools', label: 'Client Tools', description: 'defineTool() patterns — schemas, annotations, return values' },
  { path: '/server-tools', label: 'Server Tools', description: 'Server-side tools with defineServerTool()' },
  { path: '/remote-mcp-tools', label: 'Remote MCP Tools', description: 'Remote MCP tool execution and authentication' },
  { path: '/embedded-chat', label: 'Embedded Chat', description: 'UseAIChat component with renderChat={false} for custom layouts' },
  { path: '/programmatic-chat', label: 'Programmatic Chat', description: 'Sending messages programmatically via sendMessage()' },
  { path: '/chat-history', label: 'Chat History', description: 'localStorage persistence, ChatRepository, chat management' },
  { path: '/slash-commands', label: 'Slash Commands', description: 'Slash command autocomplete and custom command repository' },
  { path: '/custom-ui', label: 'Custom UI', description: 'CustomButton, CustomChat props and onOpenChange callback' },
  { path: '/theme-i18n', label: 'Theme & i18n', description: 'Theme colors, strings localization, error messages' },
  { path: '/suggestions', label: 'Suggestions', description: 'Empty chat suggestions aggregated from all components' },
  { path: '/destructive-approval', label: 'Destructive Approval', description: 'destructiveHint annotation and approval dialog flow' },
  { path: '/invisible-test', label: 'Invisible Providers', description: 'invisible: true for provider components and global tools' },
  { path: '/file-transformers', label: 'File Transformers', description: 'File transformation before sending to AI' },
  { path: '/multimodal', label: 'Multimodal', description: 'File upload configuration with fileUploadConfig' },
  { path: '/multi-agent', label: 'Multi-Agent', description: 'Multiple agents, visibleAgentIds, agent selection' },
  { path: '/workflow-demo', label: 'Workflow Integration', description: 'Headless workflow execution with Dify' },
  { path: '/error-tracing-test', label: 'Error Tracing', description: 'Error scenarios and Langfuse error traces' },
] as const;

type PagePath = typeof AVAILABLE_PAGES[number]['path'];

/**
 * Provides AI-accessible navigation tools.
 * Must be placed inside the Router context.
 */
export function NavigationAIProvider({ children }: { children: ReactNode }) {
  const { navigate, currentRoute } = useRouter();

  const tools = {
    navigateTo: defineTool(
      `Navigate to a different page in the application. Available pages: ${AVAILABLE_PAGES.map(p => `${p.label} (${p.path})`).join(', ')}`,
      z.object({
        path: z.enum(AVAILABLE_PAGES.map(p => p.path) as [PagePath, ...PagePath[]]).describe(
          'The path to navigate to'
        ),
      }),
      (input) => {
        const page = AVAILABLE_PAGES.find(p => p.path === input.path);
        if (!page) {
          return { success: false, error: `Unknown page: ${input.path}` };
        }

        if (currentRoute === input.path) {
          return { success: true, message: `Already on ${page.label} page` };
        }

        navigate(input.path);
        return {
          success: true,
          message: `Navigated to ${page.label} page`,
          previousPage: currentRoute,
          currentPage: input.path,
        };
      },
      { annotations: { title: 'Navigating' } }
    ),

    getCurrentPage: defineTool(
      'Get information about the current page',
      z.object({}),
      () => {
        const page = AVAILABLE_PAGES.find(p => p.path === currentRoute);
        return {
          success: true,
          currentPath: currentRoute,
          pageName: page?.label ?? 'Unknown',
          description: page?.description ?? 'Unknown page',
        };
      },
      { annotations: { title: 'Getting Current Page', readOnlyHint: true } }
    ),
  };

  useAI({
    tools,
    prompt: `Current page: ${currentRoute}`,
    invisible: true,
  });

  return <>{children}</>;
}
