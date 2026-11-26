type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogData {
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  private format: 'json' | 'pretty';
  private silent: boolean;
  // User prompts, model output and tool I/O are only logged when explicitly enabled.
  private logLlmContent: boolean;

  constructor() {
    this.format = (process.env.LOG_FORMAT as 'json' | 'pretty') || 'pretty';
    this.silent = process.env.LOG_SILENT === 'true' || process.env.LOG_SILENT === '1';
    this.logLlmContent = process.env.LOG_LLM_CONTENT === 'true' || process.env.LOG_LLM_CONTENT === '1';
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (this.silent) return;
    if (this.format === 'json') {
      this.logJson(level, message, data);
    } else {
      this.logPretty(level, message, data);
    }
  }

  private logJson(level: LogLevel, message: string, data?: Record<string, unknown>) {
    const logEntry: LogData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };
    console.log(JSON.stringify(logEntry));
  }

  private logPretty(level: LogLevel, message: string, data?: Record<string, unknown>) {
    const emoji = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      debug: '🔍',
    }[level];

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`${emoji} [${timestamp}] ${message}`);

    if (data && Object.keys(data).length > 0) {
      Object.entries(data).forEach(([key, value]) => {
        // For stack traces and error details, show full content
        if (key === 'stack' || key === 'cause') {
          console.log(`   ${key}:`);
          console.log(`      ${value}`);
        } else if (typeof value === 'string' && value.length > 100) {
          // NEVER truncate error logs - they need full details for debugging
          if (level === 'error') {
            console.log(`   ${key}: ${value}`);
          } else {
            console.log(`   ${key}: ${value.substring(0, 100)}...`);
          }
        } else if (typeof value === 'object') {
          // For objects, use util.inspect for better formatting
          console.log(`   ${key}:`, JSON.stringify(value, null, 2));
        } else {
          console.log(`   ${key}:`, value);
        }
      });
    }
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log('error', message, data);
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log('debug', message, data);
  }

  // Special methods for pretty logging only
  apiRequest(data: {
    tools: string[];
    messageCount: number;
    messages?: Array<{ role: string; preview: string }>;
    systemMessages?: string[];
  }) {
    if (this.silent) return;
    if (!this.logLlmContent) {
      data = { tools: data.tools, messageCount: data.messageCount };
    }
    if (this.format === 'json') {
      this.logJson('info', 'API request', data);
      return;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 API REQUEST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 TOOLS:', data.tools.join(', '));
    console.log('💬 MESSAGES:', data.messageCount, 'total');
    data.messages?.forEach((msg, i) => {
      console.log(`  ${i + 1}. [${msg.role}] ${msg.preview}`);
    });
    if (data.systemMessages && data.systemMessages.length > 0) {
      console.log('📋 SYSTEM MESSAGES:');
      data.systemMessages.forEach((msg, i) => {
        console.log(`  ${i + 1}. ${msg.substring(0, 150)}${msg.length > 150 ? '...' : ''}`);
      });
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  aiResponse(textBlocks: string[]) {
    if (this.silent || !this.logLlmContent) return;
    if (this.format === 'json') {
      this.logJson('info', 'AI response', { responseCount: textBlocks.length, responses: textBlocks });
      return;
    }

    console.log('\n💬 AI RESPONSE:');
    textBlocks.forEach(text => {
      const preview = text.substring(0, 200).replace(/\n/g, ' ');
      console.log(`   "${preview}${text.length > 200 ? '...' : ''}"`);
    });
  }

  toolCalls(tools: Array<{ name: string; input: unknown }>) {
    if (this.silent || !this.logLlmContent) return;
    if (this.format === 'json') {
      this.logJson('info', 'Tool calls', { toolCount: tools.length, tools });
      return;
    }

    console.log('\n🔨 TOOL CALLS:', tools.length);
    tools.forEach((tool, i) => {
      console.log(`   ${i + 1}. ${tool.name}(${JSON.stringify(tool.input).substring(0, 50)}...)`);
    });
  }

  toolError(toolName: string, toolCallId: string, error: unknown) {
    if (this.silent) return;
    if (this.logLlmContent) {
      this.toolResult(toolName, `ERROR: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    // The message can embed tool input, so only the error name is logged.
    this.warn('Tool execution failed', {
      toolName,
      toolCallId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  toolResult(toolName: string, result: unknown) {
    if (this.silent || !this.logLlmContent) return;
    if (this.format === 'json') {
      this.logJson('info', 'Tool result', { toolName, result });
      return;
    }

    console.log(`   ✓ ${toolName} → ${JSON.stringify(result).substring(0, 80)}...`);
  }
}

export const logger = new Logger();
