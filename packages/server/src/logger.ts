type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogData {
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

/** Exported for tests; use the `logger` instance. */
export class Logger {
  private format: 'json' | 'pretty';
  private silent: boolean;

  constructor() {
    this.format = (process.env.LOG_FORMAT as 'json' | 'pretty') || 'pretty';
    this.silent = process.env.LOG_SILENT === 'true' || process.env.LOG_SILENT === '1';
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
    // Drop timestamp, level and message from data, so values passed in data (e.g. client metadata) cannot replace the logger's own.
    const { timestamp: _timestamp, level: _level, message: _message, ...rest } = data ?? {};
    const logEntry: LogData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...rest,
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
    messages: Array<{ role: string; preview: string }>;
    systemMessages?: string[];
  }) {
    if (this.silent) return;
    if (this.format === 'json') {
      this.logJson('info', 'API request', data);
      return;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 API REQUEST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 TOOLS:', data.tools.join(', '));
    console.log('💬 MESSAGES:', data.messageCount, 'total');
    data.messages.forEach((msg, i) => {
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
    if (this.silent) return;
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
    if (this.silent) return;
    if (this.format === 'json') {
      this.logJson('info', 'Tool calls', { toolCount: tools.length, tools });
      return;
    }

    console.log('\n🔨 TOOL CALLS:', tools.length);
    tools.forEach((tool, i) => {
      console.log(`   ${i + 1}. ${tool.name}(${JSON.stringify(tool.input).substring(0, 50)}...)`);
    });
  }

  toolResult(toolName: string, result: unknown) {
    if (this.silent) return;
    if (this.format === 'json') {
      this.logJson('info', 'Tool result', { toolName, result });
      return;
    }

    console.log(`   ✓ ${toolName} → ${JSON.stringify(result).substring(0, 80)}...`);
  }
}

export const logger = new Logger();
