/**
 * 一括移動 / 一括削除の中核ロジック（U13）。
 *
 * React / chrome API に依存しない純粋な非同期関数群にし、`useRowActions`（React 層）と
 * ユニットテスト（`bulkActionsCore.test.ts`）から利用する。`SearchEngine`/`AliasStore` と同じ DI 方針:
 * chrome API ラッパ（`BookmarkService` 等）は構造的インターフェースで受け、呼び出し側が注入する。
 *
 * 部分失敗への耐性を型で保証する: forward（実行）・undo（巻き戻し）のどちらも**1件ごとに独立して**
 * 処理し、1件の失敗が他の件の処理を止めない。これにより、20件中1件が失敗しても残り19件は正しく
 * 反映され、undo（1回きり）も可能な限り全件を戻す（development-guidelines「破壊的操作は必ずアンドゥ
 * 手段を伴わせる」・PRD 機能8「一括操作のアンドゥは1単位として扱う」の実効性を保つ）。
 */
import type { BookmarkNode } from '@extension/storage';

// ── 一括移動 ──

/** `moveRowsCore`/`undoMoveRowsCore` が必要とする最小契約（`BookmarkService`/`SearchEngine` を構造的に満たす）。 */
interface MoveDeps {
  move(id: string, parentId: string): Promise<void>;
  moveNode(id: string, parentId: string, folderPath: string[]): void;
}

/** 移動対象1件（`SearchResultItem` から呼び出し側が変換して渡す）。 */
interface BulkMoveTarget {
  id: string;
  parentId: string | undefined;
  folderPath: string[];
}

/** 移動に成功した1件の復元用データ（undo の入力）。 */
interface MovedRecord {
  id: string;
  originalParentId: string | undefined;
  originalFolderPath: string[];
}

interface BulkMoveResult {
  /** 成功した件の復元用データ（undo にそのまま渡す）。 */
  moved: MovedRecord[];
  /** 1件以上失敗したか（呼び出し側のエラートースト判定に使う）。 */
  anyFailed: boolean;
}

/**
 * 対象フォルダに既にある行を除外して一括移動する。1件ごとに独立して実行し、失敗した件はスキップして
 * 続行する（他の件の移動を巻き添えにしない）。成功した件のみ `moved` に積む。
 */
const moveRowsCore = async (
  targets: readonly BulkMoveTarget[],
  targetFolderId: string,
  targetFolderPath: string[],
  deps: MoveDeps,
): Promise<BulkMoveResult> => {
  const filtered = targets.filter(t => t.parentId !== targetFolderId);
  const moved: MovedRecord[] = [];
  let anyFailed = false;
  for (const t of filtered) {
    try {
      await deps.move(t.id, targetFolderId);
    } catch {
      anyFailed = true;
      continue;
    }
    deps.moveNode(t.id, targetFolderId, targetFolderPath);
    moved.push({ id: t.id, originalParentId: t.parentId, originalFolderPath: t.folderPath });
  }
  return { moved, anyFailed };
};

/**
 * 一括移動の undo（成功した全件を元の親へ戻す）。1件ごとに独立して try/catch し、途中の失敗で
 * 残りの件が戻されない・索引の更新が反映されないまま終わることを防ぐ（undo は1回で消費されるため、
 * ここで処理を止めると再試行の機会がない）。元の親が不明（`parentId` 無し）な件は戻せずスキップする。
 */
const undoMoveRowsCore = async (moved: readonly MovedRecord[], deps: MoveDeps): Promise<{ anyFailed: boolean }> => {
  let anyFailed = false;
  for (const m of moved) {
    if (m.originalParentId === undefined) {
      anyFailed = true;
      continue;
    }
    try {
      await deps.move(m.id, m.originalParentId);
      deps.moveNode(m.id, m.originalParentId, m.originalFolderPath);
    } catch {
      anyFailed = true;
    }
  }
  return { anyFailed };
};

// ── 一括削除 ──

/**
 * `deleteRowsCore`/`undoDeleteRowsCore` が必要とする最小契約。
 *
 * `pushTrash`/`removeTrash`（U16）は**必須**にしている。任意（`?`）にすると呼び出し側が
 * 渡し忘れてもコンパイルが通り、第2層防御（30日ゴミ箱）が気づかないまま無効化されるため、
 * 型でその漏れを検出させる。
 */
interface DeleteDeps {
  remove(id: string): Promise<void>;
  removeAlias(url: string): Promise<void>;
  removeNode(id: string): void;
  ensureFolderPath(path: string[]): Promise<string>;
  create(data: { url: string; title: string; parentId: string }): Promise<BookmarkNode>;
  upsertAlias(url: string, aliases: string[]): Promise<void>;
  addNode(node: BookmarkNode, folderPath: string[], aliases: string[]): void;
  /** 削除データをゴミ箱へ退避する（第2層防御）。失敗しても削除自体は成功扱いで続行する。 */
  pushTrash(target: BulkDeleteTarget): Promise<string | null>;
  /** アンドゥで元に戻した際、対応するゴミ箱項目を取り消す（復元済みの重複防止）。 */
  removeTrash(trashId: string): Promise<void>;
}

/** 削除対象1件（`SearchResultItem` から呼び出し側が変換して渡す。`url` は非空を保証済み）。 */
interface BulkDeleteTarget {
  id: string;
  title: string;
  url: string;
  folderPath: string[];
  aliases: string[];
}

/** 削除に成功した1件の復元用データ（undo の入力）。 */
interface RemovedRecord {
  id: string;
  title: string;
  url: string;
  folderPath: string[];
  aliases: string[];
  /** ゴミ箱内 ID（`pushTrash` が成功した場合のみ設定。undo 成功時に `removeTrash` へ渡す）。 */
  trashId: string | null;
}

interface BulkDeleteResult {
  removed: RemovedRecord[];
  anyFailed: boolean;
}

/**
 * 一括削除する。1件ごとに独立して実行し、失敗した件はスキップして続行する。別名の除去・ゴミ箱への
 * 退避に失敗してもブックマーク自体は削除済みのため続行する（単一版 `deleteRow` と同じ方針。別名の
 * 残留は undo の upsert で上書きされ整合する）。成功した件のみ `removed` に積む。
 */
const deleteRowsCore = async (targets: readonly BulkDeleteTarget[], deps: DeleteDeps): Promise<BulkDeleteResult> => {
  const removed: RemovedRecord[] = [];
  let anyFailed = false;
  for (const t of targets) {
    try {
      await deps.remove(t.id);
    } catch {
      anyFailed = true;
      continue;
    }
    try {
      await deps.removeAlias(t.url);
    } catch {
      // ブックマークは既に削除済みのため索引更新・復元用データの記録は続行する。
    }
    let trashId: string | null = null;
    try {
      trashId = await deps.pushTrash(t);
    } catch (e) {
      // ゴミ箱（第2層防御）への退避が失敗しても、削除操作自体は成功扱いで続行する
      // （UI と実データの乖離を作らない。development-guidelines「エラーハンドリング」）。
      // ただし第2層防御が無効化された事実は失わないよう console.error に残す。
      console.error('[bulkActionsCore] ゴミ箱への退避に失敗しました:', e);
    }
    deps.removeNode(t.id);
    removed.push({ id: t.id, title: t.title, url: t.url, folderPath: t.folderPath, aliases: t.aliases, trashId });
  }
  return { removed, anyFailed };
};

/**
 * 一括削除の undo（成功した全件を再作成する）。1件ごとに独立して try/catch し、途中の失敗で
 * 残りの件の再作成が試みられない・成功済みの件が反映されないまま終わることを防ぐ。
 * 再作成に成功した件で `trashId` があれば、対応するゴミ箱項目を取り消す（復元済みの重複防止）。
 */
const undoDeleteRowsCore = async (
  removed: readonly RemovedRecord[],
  deps: DeleteDeps,
): Promise<{ anyFailed: boolean }> => {
  let anyFailed = false;
  for (const r of removed) {
    try {
      const parentId = await deps.ensureFolderPath(r.folderPath);
      const created = await deps.create({ url: r.url, title: r.title, parentId });
      if (r.aliases.length > 0) {
        await deps.upsertAlias(r.url, r.aliases);
      }
      deps.addNode(created, r.folderPath, r.aliases);
      if (r.trashId !== null) {
        await deps.removeTrash(r.trashId).catch(e => {
          // ゴミ箱側の取り消しに失敗しても、再作成自体は成功済みのため anyFailed にはしない
          // （復元済みの項目がゴミ箱にも残るだけで実害は小さい。ログは useRowActions.deleteRow と揃え、
          //  console.error のみ残す）。
          console.error('[bulkActionsCore] ゴミ箱項目の取り消しに失敗しました:', e);
        });
      }
    } catch {
      anyFailed = true;
    }
  }
  return { anyFailed };
};

export { moveRowsCore, undoMoveRowsCore, deleteRowsCore, undoDeleteRowsCore };
export type { MoveDeps, BulkMoveTarget, MovedRecord, DeleteDeps, BulkDeleteTarget, RemovedRecord };
