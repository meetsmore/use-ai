import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { ToolsService } from './tools.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'test-mcp-server',
      version: '1.0.0',
      streamableHttp: {
        enableJsonResponse: true,
        statelessMode: true,
      },
    }),
  ],
  controllers: [HealthController],
  providers: [ToolsService],
})
export class AppModule {}
