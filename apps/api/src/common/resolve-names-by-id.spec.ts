import { In, Repository } from 'typeorm';
import { resolveNamesById } from './resolve-names-by-id';

describe('resolveNamesById', () => {
  it('returns an empty Map without querying when ids is empty', async () => {
    const find = jest.fn();
    const result = await resolveNamesById({ find } as unknown as Repository<{ id: string; name: string }>, []);

    expect(result).toEqual(new Map());
    expect(find).not.toHaveBeenCalled();
  });

  it('batches every id into a single WHERE id IN (...) query', async () => {
    const find = jest.fn().mockResolvedValue([
      { id: 's1', name: 'Salon One' },
      { id: 's2', name: 'Salon Two' },
    ]);

    await resolveNamesById({ find } as unknown as Repository<{ id: string; name: string }>, ['s1', 's2']);

    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ where: { id: In(['s1', 's2']) } });
  });

  it('maps each returned row by id to its name', async () => {
    const find = jest.fn().mockResolvedValue([
      { id: 's1', name: 'Salon One' },
      { id: 's2', name: 'Salon Two' },
    ]);

    const result = await resolveNamesById({ find } as unknown as Repository<{ id: string; name: string }>, ['s1', 's2']);

    expect(result.get('s1')).toBe('Salon One');
    expect(result.get('s2')).toBe('Salon Two');
  });

  it('leaves an id absent from the Map when the row no longer exists -- the fallback is the caller\'s job', async () => {
    const find = jest.fn().mockResolvedValue([{ id: 's1', name: 'Salon One' }]);

    const result = await resolveNamesById({ find } as unknown as Repository<{ id: string; name: string }>, ['s1', 'deleted-id']);

    expect(result.has('deleted-id')).toBe(false);
    expect(result.get('deleted-id')).toBeUndefined();
  });
});
