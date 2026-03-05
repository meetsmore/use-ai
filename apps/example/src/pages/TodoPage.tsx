import React from 'react';
import TodoList from '../TodoList';
import { docStyles } from '../styles/docStyles';
import { CollapsibleCode } from '../components/CollapsibleCode';

export default function TodoPage() {
  return (
    <div style={docStyles.container}>
      <h1 style={docStyles.title}>Todo List</h1>

      <div style={docStyles.infoCard}>
        <h2 style={docStyles.subtitle}>About</h2>
        <p style={docStyles.text}>
          The fundamental <code style={docStyles.code}>useAI</code> +{' '}
          <code style={docStyles.code}>defineTool</code> pattern. This page demonstrates
          how to expose React component state and actions to Claude AI via tools.
        </p>
        <p style={docStyles.text}>
          The AI sees your todo list through the <code style={docStyles.code}>prompt</code> prop
          and can add, delete, toggle, and clear todos using the registered tools.
          Multiple tool calls are batched together — ask the AI to "add three items"
          and it will call <code style={docStyles.code}>addTodo</code> three times in one turn.
        </p>
      </div>

      <div style={docStyles.definitionCard}>
        <h2 style={docStyles.subtitle}>Code Example</h2>
        <CollapsibleCode>
{`import { useAI, defineTool } from '@meetsmore-oss/use-ai-client';
import { z } from 'zod';

function TodoList() {
  const { todos, tools, addTodo, toggleTodo, deleteTodo } = useTodoLogic();

  useAI({
    tools,
    prompt: \`Todo List (Total: \${todos.length}, Done: \${todos.filter(t => t.completed).length}):
\${todos.map(t => \`- [\${t.completed ? 'x' : ' '}] #\${t.id}: \${t.text}\`).join('\\n')}\`,
    suggestions: ['Add a todo to buy groceries', 'Create a shopping list for dinner'],
  });

  return (/* todo list UI */);
}

// In useTodoLogic.ts:
const addTodo = defineTool(
  'Add a new todo item to the list',
  z.object({ text: z.string().describe('The text content of the todo item') }),
  (input) => addTodoFn(input.text),
  { annotations: { title: 'Adding Todo' } }
);

const deleteTodo = defineTool(
  'Delete a todo item by its ID',
  z.object({ id: z.number().describe('The ID of the todo item to delete') }),
  (input) => deleteTodoFn(input.id),
  { annotations: { title: 'Deleting Todo', destructiveHint: true } }
);`}
        </CollapsibleCode>
      </div>

      <div style={docStyles.demoCard}>
        <h2 style={docStyles.subtitle}>Interactive Demo</h2>
        <p style={docStyles.text}>
          Open the chat panel and try: "Add three items: buy milk, clean house, call dentist"
        </p>
        <TodoList />
      </div>
    </div>
  );
}
