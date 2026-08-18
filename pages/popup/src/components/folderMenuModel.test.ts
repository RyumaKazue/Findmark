import { buildFolderMenuItems, planRename, validateFolderTitle } from './folderMenuModel.js';
import { describe, expect, it } from 'vitest';

describe('buildFolderMenuItems（項目の並びと無効条件）', () => {
  it('新しいフォルダ → 名前を変更 → フォルダを削除 の順で返す（AC-1）', () => {
    expect(buildFolderMenuItems({ isTopLevel: false }).map(item => item.key)).toEqual(['create', 'rename', 'delete']);
  });

  it('削除だけが破壊的（danger）で、その上に区切り線が入る', () => {
    const items = buildFolderMenuItems({ isTopLevel: false });
    const deleteItem = items.find(item => item.key === 'delete');
    expect(deleteItem?.danger).toBe(true);
    expect(deleteItem?.separatorBefore).toBe(true);
  });

  it('区切り線は1本だけ（メニューが分割されすぎない）', () => {
    expect(buildFolderMenuItems({ isTopLevel: false }).filter(item => item.separatorBefore).length).toBe(1);
  });

  it('通常フォルダでは3項目とも有効', () => {
    for (const item of buildFolderMenuItems({ isTopLevel: false })) {
      expect(item.disabled).toBeFalsy();
    }
  });

  it('最上位フォルダでは名前変更と削除が無効になる（Chrome がルート直下の update/removeTree を拒否する・AC-6）', () => {
    const items = buildFolderMenuItems({ isTopLevel: true });
    expect(items.find(item => item.key === 'rename')?.disabled).toBe(true);
    expect(items.find(item => item.key === 'delete')?.disabled).toBe(true);
  });

  it('最上位フォルダでも「新しいフォルダ」は有効（直下へのサブフォルダ作成は拒否されない・AC-6）', () => {
    expect(buildFolderMenuItems({ isTopLevel: true }).find(item => item.key === 'create')?.disabled).toBeFalsy();
  });

  it('最上位でも項目は3つのまま（無効項目を配列から落とさず、対象ごとに並びが変わらない）', () => {
    expect(buildFolderMenuItems({ isTopLevel: true }).map(item => item.key)).toEqual(['create', 'rename', 'delete']);
  });
});

describe('validateFolderTitle（フォルダ名の検証）', () => {
  it('空文字は不可', () => {
    const result = validateFolderTitle('');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message.key).toBe('popupErrorFolderNameRequired');
  });

  it('空白のみ（半角・全角・タブ）は不可（AC-7）', () => {
    for (const raw of ['   ', '\t', '　']) {
      expect(validateFolderTitle(raw).ok).toBe(false);
    }
  });

  it('通常のフォルダ名は許可', () => {
    expect(validateFolderTitle('開発').ok).toBe(true);
  });

  it('前後に空白があっても中身があれば許可（trim は planRename が行う）', () => {
    expect(validateFolderTitle('  開発  ').ok).toBe(true);
  });

  it('`/` を含む名前も許可（スコープ判定は ID で行うためパス区切りと衝突しない）', () => {
    expect(validateFolderTitle('a/b').ok).toBe(true);
  });

  it('同名かどうかは判定しない（Chrome 自身が同名フォルダを許可するため）', () => {
    expect(validateFolderTitle('開発').ok).toBe(true);
    expect(validateFolderTitle('開発').ok).toBe(true);
  });
});

describe('planRename（名前変更の確定判定）', () => {
  it('変更があれば update を返し、前後の空白は落とす', () => {
    expect(planRename('chrome', '  Chrome拡張 ')).toEqual({ type: 'update', title: 'Chrome拡張' });
  });

  it('同じ名前なら unchanged（chrome API も索引の再構築も走らせない・AC-8）', () => {
    expect(planRename('chrome', 'chrome')).toEqual({ type: 'unchanged' });
  });

  it('前後の空白だけの差は unchanged（実データが同じなのに索引を作り直さない）', () => {
    expect(planRename('chrome', '  chrome  ')).toEqual({ type: 'unchanged' });
  });

  it('元の名前に前後空白があっても trim して比較する', () => {
    expect(planRename('  chrome  ', 'chrome')).toEqual({ type: 'unchanged' });
  });

  it('空・空白のみは invalid（差分を見る前に弾く）', () => {
    expect(planRename('chrome', '').type).toBe('invalid');
    expect(planRename('chrome', '   ').type).toBe('invalid');
  });

  it('検証するのは入力値だけで、元の名前が空白のみでも update になる（防御的な境界の固定）', () => {
    expect(planRename('   ', 'abc')).toEqual({ type: 'update', title: 'abc' });
  });
});
