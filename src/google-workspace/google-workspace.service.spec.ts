import { Test, TestingModule } from '@nestjs/testing';
import { GoogleWorkspaceService } from './google-workspace.service';

describe('GoogleWorkspaceService', () => {
  let service: GoogleWorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleWorkspaceService],
    }).compile();

    service = module.get<GoogleWorkspaceService>(GoogleWorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
