import { ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AdminShowcaseController } from './admin-showcase.controller';
import { PortfolioItem } from './portfolio-item.entity';
import { SalonStory } from './salon-story.entity';

describe('AdminShowcaseController status toggles', () => {
  let controller: AdminShowcaseController;
  let stories: { findOneBy: jest.Mock; findOneByOrFail: jest.Mock; update: jest.Mock };
  let items: { findOneBy: jest.Mock; findOneByOrFail: jest.Mock; update: jest.Mock };

  beforeEach(() => {
    stories = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'story-1', status: 'published' }),
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'story-1', status: 'removed' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    items = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'item-1', status: 'published' }),
      findOneByOrFail: jest.fn().mockResolvedValue({ id: 'item-1', status: 'removed' }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    controller = new AdminShowcaseController(
      stories as unknown as Repository<SalonStory>,
      items as unknown as Repository<PortfolioItem>,
    );
  });

  it('removes a published story via a conditional status set (no delete)', async () => {
    const result = await controller.setStoryStatus('story-1', { status: 'removed' });

    expect(stories.update).toHaveBeenCalledWith({ id: 'story-1', status: 'published' }, { status: 'removed' });
    expect(result.status).toBe('removed');
  });

  it('restores a removed story by conditionally flipping it back to published', async () => {
    stories.findOneBy.mockResolvedValue({ id: 'story-1', status: 'removed' });
    stories.findOneByOrFail.mockResolvedValue({ id: 'story-1', status: 'published' });

    const result = await controller.setStoryStatus('story-1', { status: 'published' });

    expect(stories.update).toHaveBeenCalledWith({ id: 'story-1', status: 'removed' }, { status: 'published' });
    expect(result.status).toBe('published');
  });

  it('404s an unknown story without writing', async () => {
    stories.findOneBy.mockResolvedValue(null);

    await expect(controller.setStoryStatus('missing', { status: 'removed' })).rejects.toBeInstanceOf(NotFoundException);
    expect(stories.update).not.toHaveBeenCalled();
  });

  it('409s with the Persian message when the story is already removed (lost race)', async () => {
    stories.update.mockResolvedValue({ affected: 0 });

    await expect(controller.setStoryStatus('story-1', { status: 'removed' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این مورد قبلاً حذف شده است',
    });
  });

  it('409s when restoring a story that is already published', async () => {
    stories.update.mockResolvedValue({ affected: 0 });

    await expect(controller.setStoryStatus('story-1', { status: 'published' })).rejects.toMatchObject({
      constructor: ConflictException,
      message: 'این مورد در حال حاضر منتشر است',
    });
  });

  it('removes and restores a portfolio item through the same conditional semantics', async () => {
    await controller.setPortfolioStatus('item-1', { status: 'removed' });
    expect(items.update).toHaveBeenCalledWith({ id: 'item-1', status: 'published' }, { status: 'removed' });

    items.update.mockResolvedValue({ affected: 0 });
    await expect(controller.setPortfolioStatus('item-1', { status: 'removed' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404s an unknown portfolio item without writing', async () => {
    items.findOneBy.mockResolvedValue(null);

    await expect(controller.setPortfolioStatus('missing', { status: 'published' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(items.update).not.toHaveBeenCalled();
  });
});
