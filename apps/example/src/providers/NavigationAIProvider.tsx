import React, { ReactNode } from 'react';
import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';
import { useRouter } from '../router';

const AVAILABLE_PAGES = [
  { path: '/', label: 'Todo', description: 'Todo list management page' },
  { path: '/calculator', label: 'Calculator', description: 'Calculator page for math calculations' },
  { path: '/combined', label: 'Combined', description: 'Combined todo and calculator page' },
  { path: '/multi-list', label: 'Multi-List', description: 'Multiple list items test page' },
  { path: '/invisible-test', label: 'Invisible Test', description: 'Invisible component test page' },
  { path: '/workflow-demo', label: 'Workflow Demo', description: 'Workflow demo page' },
  { path: '/remote-mcp-tools', label: 'Remote MCP Tools', description: 'Remote MCP tools page' },
  { path: '/embedded-chat', label: 'Embedded Chat', description: 'Embedded chat layout page' },
  { path: '/programmatic-chat', label: 'Programmatic Chat', description: 'Programmatic chat control page' },
  { path: '/file-transformers', label: 'File Transformers', description: 'File transformers page' },
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
