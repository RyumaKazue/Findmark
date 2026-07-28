import { planCommit, validateUrl } from './inlineEditModel.js';
import { describe, expect, it } from 'vitest';

describe('validateUrl', () => {
  it('正常なURLは許可する', () => {
    expect(validateUrl('https://example.com/path')).toEqual({ ok: true });
  });

  it('空文字は不正', () => {
    expect(validateUrl('')).toEqual({ ok: false, message: 'URLを入力してください' });
  });

  it('空白のみは不正', () => {
    expect(validateUrl('   ')).toEqual({ ok: false, message: 'URLを入力してください' });
  });

  it('スキームなしはパース不能として不正', () => {
    const result = validateUrl('example.com');
    expect(result.ok).toBe(false);
  });

  it('javascript: スキームは不正', () => {
    const result = validateUrl('javascript:alert(1)');
    expect(result).toEqual({ ok: false, message: 'このスキームのURLは登録できません' });
  });

  it('data: スキームは不正', () => {
    const result = validateUrl('data:text/html,<script>alert(1)</script>');
    expect(result).toEqual({ ok: false, message: 'このスキームのURLは登録できません' });
  });

  it('chrome: スキームは許可する（既存ブックマークが持ち得るため）', () => {
    expect(validateUrl('chrome://extensions')).toEqual({ ok: true });
  });
});

describe('planCommit', () => {
  const original = { title: 'GitHub', url: 'https://github.com' };

  it('差分がなければ unchanged', () => {
    expect(planCommit(original, { title: 'GitHub', url: 'https://github.com' })).toEqual({ type: 'unchanged' });
  });

  it('タイトルのみ変更されていれば title のみを含む update', () => {
    expect(planCommit(original, { title: 'ハブ', url: 'https://github.com' })).toEqual({
      type: 'update',
      title: 'ハブ',
    });
  });

  it('URLのみ変更されていれば url のみを含む update', () => {
    expect(planCommit(original, { title: 'GitHub', url: 'https://github.com/x' })).toEqual({
      type: 'update',
      url: 'https://github.com/x',
    });
  });

  it('両方変更されていれば両方を含む update', () => {
    expect(planCommit(original, { title: 'ハブ', url: 'https://github.com/x' })).toEqual({
      type: 'update',
      title: 'ハブ',
      url: 'https://github.com/x',
    });
  });

  it('URLが不正なら他の差分に関わらず invalid', () => {
    expect(planCommit(original, { title: 'ハブ', url: 'not a url' })).toEqual({
      type: 'invalid',
      message: 'URLの形式が正しくありません',
    });
  });

  it('タイトル前後の空白だけの変更は unchanged になる', () => {
    expect(planCommit(original, { title: '  GitHub  ', url: 'https://github.com' })).toEqual({ type: 'unchanged' });
  });

  it('URL前後の空白だけの変更は unchanged になる', () => {
    expect(planCommit(original, { title: 'GitHub', url: '  https://github.com  ' })).toEqual({ type: 'unchanged' });
  });
});
