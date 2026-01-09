import { useState, useRef } from 'react';
import { defineTool } from '@meetsmore/use-ai-client';
import { z } from 'zod';

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

export function useTodoLogic() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const nextIdRef = useRef(1);
  const todosRef = useRef<Todo[]>([]);

  // Keep ref in sync with state for synchronous access in tool callbacks
  todosRef.current = todos;

  const addTodoFn = (text: string) => {
    if (!text.trim()) {
      return { success: false, error: 'Text is required' };
    }

    const newTodo: Todo = {
      id: nextIdRef.current++,
      text: text.trim(),
      completed: false,
    };

    setTodos(prev => [...prev, newTodo]);

    return { success: true, id: newTodo.id, message: `Added todo: "${text}"` };
  };

  const deleteTodoFn = (id: number) => {
    // Check existence BEFORE calling setTodos (which is async)
    const todoToDelete = todosRef.current.find((t) => t.id === id);
    if (!todoToDelete) {
      return { success: false, error: `Todo with id ${id} not found` };
    }

    setTodos(prev => prev.filter((t) => t.id !== id));

    return { success: true, message: `Deleted todo: "${todoToDelete.text}"` };
  };

  const toggleTodoFn = (id: number) => {
    // Check existence BEFORE calling setTodos (which is async)
    const targetTodo = todosRef.current.find((t) => t.id === id);
    if (!targetTodo) {
      return { success: false, error: `Todo with id ${id} not found` };
    }

    setTodos(prev =>
      prev.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      )
    );

    return {
      success: true,
      message: `Marked "${targetTodo.text}" as ${!targetTodo.completed ? 'completed' : 'incomplete'}`,
    };
  };

  const clearCompletedFn = () => {
    // Count BEFORE calling setTodos (which is async)
    const completedCount = todosRef.current.filter((t) => t.completed).length;

    setTodos(prev => prev.filter((t) => !t.completed));

    return {
      success: true,
      message: `Cleared ${completedCount} completed todo(s)`,
      count: completedCount,
    };
  };

  const tools = {
    addTodo: defineTool(
      'Add a new todo item to the list',
      z.object({
        text: z.string().describe('The text content of the todo item'),
      }),
      (input) => addTodoFn(input.text)
    ),

    deleteTodo: defineTool(
      'Delete a todo item by its ID',
      z.object({
        id: z.number().describe('The ID of the todo item to delete'),
      }),
      (input) => deleteTodoFn(input.id),
      { confirmationRequired: true }
    ),

    toggleTodo: defineTool(
      'Toggle the completed status of a todo item',
      z.object({
        id: z.number().describe('The ID of the todo item to toggle'),
      }),
      (input) => toggleTodoFn(input.id)
    ),

    clearCompleted: defineTool(
      'Remove all completed todos from the list',
      z.object({}),
      () => clearCompletedFn(),
      { confirmationRequired: true }
    ),
  };

  return {
    todos,
    tools,
    addTodo: addTodoFn,
    deleteTodo: deleteTodoFn,
    toggleTodo: toggleTodoFn,
    clearCompleted: clearCompletedFn,
  };
}
