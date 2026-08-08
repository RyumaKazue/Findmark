import { deleteRowsCore, moveRowsCore, undoDeleteRowsCore, undoMoveRowsCore } from './bulkActionsCore.js';
import { describe, expect, it, vi } from 'vitest';
import type { BulkDeleteTarget, BulkMoveTarget, DeleteDeps, MovedRecord, RemovedRecord } from './bulkActionsCore.js';
import type { BookmarkNode } from '@extension/storage';

describe('moveRowsCore', () => {
  it('対象フォルダに既にある行を除外する', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    const moveNode = vi.fn();
    const targets: BulkMoveTarget[] = [{ id: '1', parentId: 'folder-a', folderPath: ['A'] }];

    const result = await moveRowsCore(targets, 'folder-a', ['A'], { move, moveNode });

    expect(move).not.toHaveBeenCalled();
    expect(result.moved).toEqual([]);
    expect(result.anyFailed).toBe(false);
  });

  it('全件成功時は moved に全件積み anyFailed=false', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    const moveNode = vi.fn();
    const targets: BulkMoveTarget[] = [
      { id: '1', parentId: 'old', folderPath: ['old'] },
      { id: '2', parentId: 'old', folderPath: ['old'] },
    ];

    const result = await moveRowsCore(targets, 'new', ['new'], { move, moveNode });

    expect(move).toHaveBeenCalledTimes(2);
    expect(moveNode).toHaveBeenCalledWith('1', 'new', ['new']);
    expect(moveNode).toHaveBeenCalledWith('2', 'new', ['new']);
    expect(result.moved.map(m => m.id)).toEqual(['1', '2']);
    expect(result.anyFailed).toBe(false);
  });

  it('部分失敗: 失敗した件はスキップし、成功した件だけ moved に積み anyFailed=true', async () => {
    const move = vi
      .fn()
      .mockImplementation((id: string) => (id === '2' ? Promise.reject(new Error('fail')) : Promise.resolve()));
    const moveNode = vi.fn();
    const targets: BulkMoveTarget[] = [
      { id: '1', parentId: 'old', folderPath: ['old'] },
      { id: '2', parentId: 'old', folderPath: ['old'] },
      { id: '3', parentId: 'old', folderPath: ['old'] },
    ];

    const result = await moveRowsCore(targets, 'new', ['new'], { move, moveNode });

    expect(result.moved.map(m => m.id)).toEqual(['1', '3']);
    expect(result.anyFailed).toBe(true);
    // 失敗した id=2 の索引更新は呼ばれない。
    expect(moveNode).not.toHaveBeenCalledWith('2', 'new', ['new']);
  });
});

describe('undoMoveRowsCore', () => {
  it('全件を元の親へ戻す', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    const moveNode = vi.fn();
    const moved: MovedRecord[] = [
      { id: '1', originalParentId: 'old-a', originalFolderPath: ['A'] },
      { id: '2', originalParentId: 'old-b', originalFolderPath: ['B'] },
    ];

    const result = await undoMoveRowsCore(moved, { move, moveNode });

    expect(move).toHaveBeenCalledWith('1', 'old-a');
    expect(move).toHaveBeenCalledWith('2', 'old-b');
    expect(result.anyFailed).toBe(false);
  });

  it('元の親が不明（undefined）な件はスキップし anyFailed=true', async () => {
    const move = vi.fn().mockResolvedValue(undefined);
    const moveNode = vi.fn();
    const moved: MovedRecord[] = [{ id: '1', originalParentId: undefined, originalFolderPath: [] }];

    const result = await undoMoveRowsCore(moved, { move, moveNode });

    expect(move).not.toHaveBeenCalled();
    expect(result.anyFailed).toBe(true);
  });

  it('部分失敗時も残りの件を継続して処理する（1件の失敗が全体を止めない）', async () => {
    const move = vi
      .fn()
      .mockImplementation((id: string) => (id === '2' ? Promise.reject(new Error('fail')) : Promise.resolve()));
    const moveNode = vi.fn();
    const moved: MovedRecord[] = [
      { id: '1', originalParentId: 'a', originalFolderPath: ['A'] },
      { id: '2', originalParentId: 'b', originalFolderPath: ['B'] },
      { id: '3', originalParentId: 'c', originalFolderPath: ['C'] },
    ];

    const result = await undoMoveRowsCore(moved, { move, moveNode });

    // id=2 が失敗しても id=3 の move は呼ばれている（=処理が途中で止まっていない）。
    expect(move).toHaveBeenCalledWith('3', 'c');
    expect(moveNode).toHaveBeenCalledWith('1', 'a', ['A']);
    expect(moveNode).toHaveBeenCalledWith('3', 'c', ['C']);
    expect(moveNode).not.toHaveBeenCalledWith('2', 'b', ['B']);
    expect(result.anyFailed).toBe(true);
  });
});

const dummyNode = (id: string): BookmarkNode => ({ id, title: 'x', url: 'https://example.com' });

describe('deleteRowsCore', () => {
  it('全件成功時は removed に全件積み anyFailed=false', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const removeAlias = vi.fn().mockResolvedValue(undefined);
    const removeNode = vi.fn();
    const targets: BulkDeleteTarget[] = [
      { id: '1', title: 'A', url: 'https://a.example.com', folderPath: [], aliases: [] },
      { id: '2', title: 'B', url: 'https://b.example.com', folderPath: [], aliases: ['えー'] },
    ];

    const result = await deleteRowsCore(targets, {
      remove,
      removeAlias,
      removeNode,
      ensureFolderPath: vi.fn(),
      create: vi.fn(),
      upsertAlias: vi.fn(),
      addNode: vi.fn(),
    });

    expect(result.removed.map(r => r.id)).toEqual(['1', '2']);
    expect(result.anyFailed).toBe(false);
    expect(removeNode).toHaveBeenCalledTimes(2);
  });

  it('部分失敗: 削除に失敗した件はスキップし anyFailed=true', async () => {
    const remove = vi
      .fn()
      .mockImplementation((id: string) => (id === '2' ? Promise.reject(new Error('fail')) : Promise.resolve()));
    const removeNode = vi.fn();
    const targets: BulkDeleteTarget[] = [
      { id: '1', title: 'A', url: 'https://a.example.com', folderPath: [], aliases: [] },
      { id: '2', title: 'B', url: 'https://b.example.com', folderPath: [], aliases: [] },
    ];

    const result = await deleteRowsCore(targets, {
      remove,
      removeAlias: vi.fn().mockResolvedValue(undefined),
      removeNode,
      ensureFolderPath: vi.fn(),
      create: vi.fn(),
      upsertAlias: vi.fn(),
      addNode: vi.fn(),
    });

    expect(result.removed.map(r => r.id)).toEqual(['1']);
    expect(result.anyFailed).toBe(true);
    expect(removeNode).toHaveBeenCalledTimes(1);
  });

  it('別名除去の失敗はブックマーク削除の成否に影響しない（続行する）', async () => {
    const removeAlias = vi.fn().mockRejectedValue(new Error('alias fail'));
    const removeNode = vi.fn();
    const targets: BulkDeleteTarget[] = [
      { id: '1', title: 'A', url: 'https://a.example.com', folderPath: [], aliases: ['x'] },
    ];

    const result = await deleteRowsCore(targets, {
      remove: vi.fn().mockResolvedValue(undefined),
      removeAlias,
      removeNode,
      ensureFolderPath: vi.fn(),
      create: vi.fn(),
      upsertAlias: vi.fn(),
      addNode: vi.fn(),
    });

    expect(result.removed.map(r => r.id)).toEqual(['1']);
    expect(result.anyFailed).toBe(false);
  });
});

describe('undoDeleteRowsCore', () => {
  it('全件を再作成する', async () => {
    const ensureFolderPath = vi.fn().mockResolvedValue('parent-1');
    const create = vi.fn().mockResolvedValue(dummyNode('new-1'));
    const upsertAlias = vi.fn().mockResolvedValue(undefined);
    const addNode = vi.fn();
    const removed: RemovedRecord[] = [
      { id: '1', title: 'A', url: 'https://a.example.com', folderPath: ['A'], aliases: ['あ'] },
    ];
    const deps: DeleteDeps = {
      remove: vi.fn(),
      removeAlias: vi.fn(),
      removeNode: vi.fn(),
      ensureFolderPath,
      create,
      upsertAlias,
      addNode,
    };

    const result = await undoDeleteRowsCore(removed, deps);

    expect(create).toHaveBeenCalledWith({ url: 'https://a.example.com', title: 'A', parentId: 'parent-1' });
    expect(upsertAlias).toHaveBeenCalledWith('https://a.example.com', ['あ']);
    expect(addNode).toHaveBeenCalled();
    expect(result.anyFailed).toBe(false);
  });

  it('部分失敗時も残りの件を継続して再作成する（1件の失敗が全体を止めない）', async () => {
    const ensureFolderPath = vi.fn().mockResolvedValue('parent-1');
    const create = vi
      .fn()
      .mockImplementation((data: { title: string }) =>
        data.title === 'B' ? Promise.reject(new Error('fail')) : Promise.resolve(dummyNode('new-1')),
      );
    const addNode = vi.fn();
    const removed: RemovedRecord[] = [
      { id: '1', title: 'A', url: 'https://a.example.com', folderPath: [], aliases: [] },
      { id: '2', title: 'B', url: 'https://b.example.com', folderPath: [], aliases: [] },
      { id: '3', title: 'C', url: 'https://c.example.com', folderPath: [], aliases: [] },
    ];
    const deps: DeleteDeps = {
      remove: vi.fn(),
      removeAlias: vi.fn(),
      removeNode: vi.fn(),
      ensureFolderPath,
      create,
      upsertAlias: vi.fn().mockResolvedValue(undefined),
      addNode,
    };

    const result = await undoDeleteRowsCore(removed, deps);

    // title='B' が失敗しても title='C' の create は呼ばれている（=処理が途中で止まっていない）。
    expect(create).toHaveBeenCalledWith({ url: 'https://c.example.com', title: 'C', parentId: 'parent-1' });
    expect(addNode).toHaveBeenCalledTimes(2); // 成功した A・C のみ
    expect(result.anyFailed).toBe(true);
  });
});
