import {
  DEFAULT_SESSION,
  deriveSession,
  resolveRestoredIndex,
  resolveRestoredScope,
  sessionsEqual,
} from './sessionModel.js';
import { describe, expect, it } from 'vitest';
import type { PopupSession } from '@extension/storage';

describe('DEFAULT_SESSION', () => {
  it('初回起動の既定値（左ペイン / すべて / クエリ空 / 選択未指定）', () => {
    expect(DEFAULT_SESSION).toEqual({ focusArea: 'folderTree', scopeFolderId: null, query: '' });
    // selectedBookmarkId は未指定（先頭行既定）。
    expect(DEFAULT_SESSION.selectedBookmarkId).toBeUndefined();
  });
});

describe('resolveRestoredScope', () => {
  it('存在するフォルダはそのまま復元する', () => {
    expect(resolveRestoredScope('f1', true)).toBe('f1');
  });

  it('存在しないフォルダは「すべて」（null）へフォールバックする（AC-5）', () => {
    expect(resolveRestoredScope('f1', false)).toBeNull();
  });

  it('保存スコープが null（すべて）ならそのまま null', () => {
    expect(resolveRestoredScope(null, true)).toBeNull();
    expect(resolveRestoredScope(null, false)).toBeNull();
  });
});

describe('resolveRestoredIndex', () => {
  it('ID 未指定なら先頭行（0）', () => {
    expect(resolveRestoredIndex(undefined, ['a', 'b', 'c'])).toBe(0);
  });

  it('一致する ID の表示順インデックスを返す（AC-8）', () => {
    expect(resolveRestoredIndex('c', ['a', 'b', 'c'])).toBe(2);
  });

  it('見つからない（削除済み）ID は先頭行（0）へフォールバック（AC-6）', () => {
    expect(resolveRestoredIndex('z', ['a', 'b', 'c'])).toBe(0);
    expect(resolveRestoredIndex('z', [])).toBe(0);
  });
});

describe('deriveSession', () => {
  it('選択 ID があるときは 4 項目すべてを含む', () => {
    expect(deriveSession({ focusArea: 'result', scopeFolderId: 'f1', selectedBookmarkId: 'b2', query: 'foo' })).toEqual(
      { focusArea: 'result', scopeFolderId: 'f1', selectedBookmarkId: 'b2', query: 'foo' },
    );
  });

  it('選択 ID が undefined のときはキー自体を省く', () => {
    const s = deriveSession({ focusArea: 'search', scopeFolderId: null, selectedBookmarkId: undefined, query: '' });
    expect(s).toEqual({ focusArea: 'search', scopeFolderId: null, query: '' });
    expect('selectedBookmarkId' in s).toBe(false);
  });
});

describe('sessionsEqual', () => {
  const base: PopupSession = { focusArea: 'result', scopeFolderId: 'f1', selectedBookmarkId: 'b2', query: 'foo' };

  it('全項目が等しければ true', () => {
    expect(sessionsEqual(base, { ...base })).toBe(true);
  });

  it('選択未指定同士は等値', () => {
    const a: PopupSession = { focusArea: 'folderTree', scopeFolderId: null, query: '' };
    const b: PopupSession = { focusArea: 'folderTree', scopeFolderId: null, query: '' };
    expect(sessionsEqual(a, b)).toBe(true);
  });

  it('いずれかの項目が異なれば false', () => {
    expect(sessionsEqual(base, { ...base, focusArea: 'search' })).toBe(false);
    expect(sessionsEqual(base, { ...base, scopeFolderId: 'f2' })).toBe(false);
    expect(sessionsEqual(base, { ...base, query: 'bar' })).toBe(false);
    expect(sessionsEqual(base, { ...base, selectedBookmarkId: 'b3' })).toBe(false);
    expect(sessionsEqual(base, { ...base, selectedBookmarkId: undefined })).toBe(false);
  });
});
