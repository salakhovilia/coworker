import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Company } from '@prisma/client';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { TextContentBlock } from 'openai/resources/beta/threads/messages';

@Injectable()
export class AgentService {
  private openai: OpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.getOrThrow('OPENAI_API_KEY'), // This is the default and can be omitted
    });
  }

  async initAgent(companyId: number) {
    const store = await this.openai.beta.vectorStores.create({
      name: String(companyId),
      metadata: { companyId: String(companyId) },
    });

    const thread = await this.openai.beta.threads.create({
      metadata: {
        companyId: String(companyId),
      },
      tool_resources: {
        file_search: {
          vector_store_ids: [store.id],
        },
      },
    });

    return { threadId: thread.id, storeId: store.id };
  }

  async ask(question: string, company: Company) {
    const data = await this.buildChatData(company.id, 15 * 24 * 60 * 60 * 1000);
    console.log(question, data);

    await this.openai.beta.threads.messages.create(company.threadId, {
      content: `${data}\n##Question\n${question}`,
      role: 'user',
    });

    const response = await this.openai.beta.threads.runs.createAndPoll(
      company.threadId,
      {
        assistant_id: this.config.getOrThrow('ASSISTANT_ID'),
        // max_completion_tokens: 100,
      },
    );

    const messages = await this.openai.beta.threads.messages.list(
      company.threadId,
      { run_id: response.id },
    );

    return (messages.data[0].content[0] as TextContentBlock).text.value;
  }

  async generateEvent(command: string, company: Company) {
    const data = await this.buildChatData(company.id, 24 * 60 * 60 * 1000);

    const calendars = await this.prisma.companySource.findMany({
      where: {
        companyId: company.id,
        type: 'gcalendar',
      },
    });

    const calendarsData =
      '## Calendars\n' +
      calendars.map((c) => `name:${c.name} - id:${c.link}`).join(',');

    const response = await this.openai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `Generate event in json format for google calendar api based on chat history, current dateTime ${new Date().toISOString()}, { "calendarId": "<Id of calendar>", "requestBody": {"summary":"<title of event>", "description": "<description of event>", "start": {"date"?: "<date>", "dateTime"?: "<dateTime>", "timeZone"?: "<timezone>"}, "end": {"date"?: "<date>", "dateTime"?: "<dateTime>", "timeZone"?: "<timezone>"}}}`,
        },
        {
          role: 'user',
          content: `${data}\n${calendarsData}\n## Command\n${command}`,
        },
      ],
      model: 'gpt-3.5-turbo',
      user: String(company.id),
      response_format: {
        type: 'json_object',
      },
    });

    const event = response.choices[0].message.content;

    try {
      return JSON.parse(event);
    } catch (err) {}

    return event;
  }

  async uploadFile(company: Company, mimetype: string, file: Response) {
    const allowedTypes = [
      'text/x-c',
      'text/x-csharp',
      'text/x-c++',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/html',
      'text/x-java',
      'application/json',
      'text/markdown',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/x-python',
      'text/x-script.python',
      'text/x-ruby',
      'text/x-tex',
      'text/plain',
      'text/css',
      'text/javascript',
      'application/x-sh',
      'application/typescript',
    ];

    if (!allowedTypes.includes(mimetype)) {
      return;
    }

    const response = await this.openai.beta.vectorStores.files.uploadAndPoll(
      company.vectorStoreId,
      file,
    );

    console.log(response);
  }

  async buildChatData(companyId: number, window: number) {
    const sources = await this.prisma.companySource.findMany({
      where: {
        companyId,
        chatHistory: {
          every: {
            timestamp: { gt: new Date(Date.now() - window) },
          },
        },
      },
      include: {
        chatHistory: true,
      },
    });

    let history = '';

    for (const source of sources) {
      if (source.type === 'chat') {
        const messagesText = source.chatHistory
          .map((m) => `${m.sender}(${m.timestamp.toISOString()}): ${m.message}`)
          .join(',');

        history += `## Chat history\n${messagesText}\n`;
      }
    }

    return history;
  }
}
