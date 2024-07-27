import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AgentService } from './agent/agent.service';
import { TelegramService } from './telegram/telegram.service';
import { PrismaService } from './prisma/prisma.service';
import { GoogleWorkspaceService } from './google-workspace/google-workspace.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { GithubService } from './github/github.service';
import { TelegramAdminService } from './telegram/telegram-admin.service';

let configPath = '.env';
if (process.env.NODE_ENV !== 'production') {
  configPath = `${process.env.NODE_ENV}.env`;
}

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: configPath,
    }),
    EventEmitterModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    AgentService,
    TelegramService,
    TelegramAdminService,
    GoogleWorkspaceService,
    GithubService,
  ],
})
export class AppModule {}
