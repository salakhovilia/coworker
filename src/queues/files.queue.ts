import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { TelegramService } from '../telegram/telegram.service';

@Processor('files')
export class FilesQueue {
  constructor(private readonly telegram: TelegramService) {}

  @Process()
  async process(job: Job<Record<string, any>>): Promise<any> {
    switch (job.data.source) {
      case 'telegram':
        await this.telegram.downloadAndProcessFile(job.data);
        break;
    }

    return {};
  }
}
