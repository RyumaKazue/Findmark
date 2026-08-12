import {
  CURRENT_VERSION,
  FORMAT_ID,
  InvalidImportFormatError,
  isMyBookmarkSearchFile,
  parseJsonFile,
  serializeJsonFile,
} from './jsonFormat.js';
import { describe, expect, it } from 'vitest';
import type { ExportBookmark } from './jsonFormat.js';

const validFile = JSON.stringify({
  format: 'my-bookmark-search',
  version: 1,
  exportedAt: '2026-07-23T10:00:00+09:00',
  bookmarks: [
    {
      url: 'https://developer.chrome.com/docs/extensions/',
      title: 'Chrome Extensions Docs',
      folderPath: ['ブックマーク バー', '開発', 'chrome'],
      aliases: ['拡張機能', 'kakuchou', 'extension docs'],
      addedAt: '2025-11-02T09:30:00+09:00',
    },
  ],
});

describe('parseJsonFile — 正常系', () => {
  it('有効なファイルを ImportBookmark[] へ変換する', () => {
    const result = parseJsonFile(validFile);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      url: 'https://developer.chrome.com/docs/extensions/',
      title: 'Chrome Extensions Docs',
      folderPath: ['ブックマーク バー', '開発', 'chrome'],
      aliases: ['拡張機能', 'kakuchou', 'extension docs'],
    });
  });

  it('addedAt を ISO8601 から epoch ms へ変換する', () => {
    const result = parseJsonFile(validFile);
    expect(result[0].addedAt).toBe(Date.parse('2025-11-02T09:30:00+09:00'));
  });

  it('addedAt 未指定でも他フィールドは正しくパースされる', () => {
    const file = JSON.stringify({
      format: 'my-bookmark-search',
      version: 1,
      bookmarks: [{ url: 'https://a.example.com', title: 'A', folderPath: [], aliases: [] }],
    });
    const result = parseJsonFile(file);
    expect(result[0].addedAt).toBeUndefined();
  });

  it('addedAt が不正な文字列なら undefined にフォールバックし、他フィールドは維持する', () => {
    const file = JSON.stringify({
      format: 'my-bookmark-search',
      version: 1,
      bookmarks: [{ url: 'https://a.example.com', title: 'A', folderPath: [], aliases: [], addedAt: 'not-a-date' }],
    });
    const result = parseJsonFile(file);
    expect(result[0].addedAt).toBeUndefined();
    expect(result[0].url).toBe('https://a.example.com');
  });

  it('folderPath/aliases が省略された要素は空配列として扱う', () => {
    const file = JSON.stringify({
      format: 'my-bookmark-search',
      version: 1,
      bookmarks: [{ url: 'https://a.example.com', title: 'A' }],
    });
    const result = parseJsonFile(file);
    expect(result[0].folderPath).toEqual([]);
    expect(result[0].aliases).toEqual([]);
  });

  it('url/title が欠けた要素だけを除外し、他の要素はそのまま返す', () => {
    const file = JSON.stringify({
      format: 'my-bookmark-search',
      version: 1,
      bookmarks: [
        { url: 'https://a.example.com', title: 'A', folderPath: [], aliases: [] },
        { title: 'URL無し', folderPath: [], aliases: [] },
        { url: 'https://b.example.com', title: 'B', folderPath: [], aliases: [] },
      ],
    });
    const result = parseJsonFile(file);
    expect(result.map(b => b.url)).toEqual(['https://a.example.com', 'https://b.example.com']);
  });
});

describe('parseJsonFile — 異常系（パース失敗は中断・部分適用しない）', () => {
  it('JSON として解釈できない文字列は InvalidImportFormatError', () => {
    expect(() => parseJsonFile('not json')).toThrow(InvalidImportFormatError);
  });

  it('format が不一致なら InvalidImportFormatError', () => {
    const file = JSON.stringify({ format: 'other-format', version: 1, bookmarks: [] });
    expect(() => parseJsonFile(file)).toThrow(InvalidImportFormatError);
  });

  it('format が欠けていれば InvalidImportFormatError', () => {
    const file = JSON.stringify({ version: 1, bookmarks: [] });
    expect(() => parseJsonFile(file)).toThrow(InvalidImportFormatError);
  });

  it('version が数値でなければ InvalidImportFormatError', () => {
    const file = JSON.stringify({ format: 'my-bookmark-search', version: '1', bookmarks: [] });
    expect(() => parseJsonFile(file)).toThrow(InvalidImportFormatError);
  });

  it('未対応の version（マイグレーション未実装）は InvalidImportFormatError', () => {
    const file = JSON.stringify({ format: 'my-bookmark-search', version: 999, bookmarks: [] });
    expect(() => parseJsonFile(file)).toThrow(InvalidImportFormatError);
  });

  it('bookmarks が配列でなければ InvalidImportFormatError', () => {
    const file = JSON.stringify({ format: 'my-bookmark-search', version: 1, bookmarks: 'not-an-array' });
    expect(() => parseJsonFile(file)).toThrow(InvalidImportFormatError);
  });
});

describe('serializeJsonFile', () => {
  it('format/version/exportedAt を含む文字列を生成する', () => {
    const bookmarks: ExportBookmark[] = [
      { url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: ['えー'] },
    ];
    const json = JSON.parse(serializeJsonFile(bookmarks));
    expect(json.format).toBe(FORMAT_ID);
    expect(json.version).toBe(CURRENT_VERSION);
    expect(typeof json.exportedAt).toBe('string');
    expect(json.bookmarks).toEqual([
      { url: 'https://a.example.com', title: 'A', folderPath: ['開発'], aliases: ['えー'] },
    ]);
  });

  it('addedAt を ISO8601 文字列として出力する', () => {
    const addedAt = Date.parse('2025-11-02T09:30:00+09:00');
    const bookmarks: ExportBookmark[] = [
      { url: 'https://a.example.com', title: 'A', folderPath: [], aliases: [], addedAt },
    ];
    const json = JSON.parse(serializeJsonFile(bookmarks));
    expect(json.bookmarks[0].addedAt).toBe(new Date(addedAt).toISOString());
  });

  it('serializeJsonFile → parseJsonFile の往復で内容が一致する（addedAt 含む）', () => {
    const addedAt = Date.parse('2025-11-02T09:30:00+09:00');
    const original: ExportBookmark[] = [
      { url: 'https://a.example.com', title: 'A', folderPath: ['開発', 'chrome'], aliases: ['あ', 'い'], addedAt },
    ];
    const roundTripped = parseJsonFile(serializeJsonFile(original));
    expect(roundTripped).toEqual(original);
  });
});

describe('isMyBookmarkSearchFile — 拡張子に依らない内容判定', () => {
  it('format が一致すれば true', () => {
    expect(isMyBookmarkSearchFile(validFile)).toBe(true);
  });

  it('format が不一致なら false', () => {
    expect(isMyBookmarkSearchFile(JSON.stringify({ format: 'other', version: 1, bookmarks: [] }))).toBe(false);
  });

  it('JSON として解釈できなければ false（例外を投げない）', () => {
    expect(isMyBookmarkSearchFile('<DL><p></DL><p>')).toBe(false);
  });

  it('version 不正でも format さえ一致すれば true（版の妥当性は parseJsonFile の責務）', () => {
    expect(isMyBookmarkSearchFile(JSON.stringify({ format: 'my-bookmark-search', version: 999 }))).toBe(true);
  });
});
