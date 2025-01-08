import { OnQueueError, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { TelegramService } from '../telegram/telegram.service';
import { Queues } from './queues';
import { Logger } from '@nestjs/common';

@Processor(Queues.Documents)
export class DocumentsQueue {
  constructor(private readonly telegram: TelegramService) {}

  @Process()
  async process(job: Job<Record<string, any>>): Promise<any> {
    switch (job.data.source) {
      case 'telegram':
        if (job.data.type === 'file') {
          await this.telegram.downloadAndProcessFile(job.data);
        } else if (job.data.type === 'chat') {
          await this.telegram.parseHistory(job.data);
        }
        break;
    }

    return {};
  }
  
  @OnQueueError()
  onError(event) {
    Logger.error(event);
  }
}
