import type { AliasRecord, BookmarkNode, LocalState, UserSettings } from '@extension/storage';

/**
 * 起動時クリーンアップ（U17・機能12/信頼性）のロジック。
 *
 * Service Worker は「薄く保つ」方針（functional-design.md）のため、本モジュールは
 * 「何を消すか」の判定（純粋関数）と、既存のサービス/データレイヤーを順に呼ぶ手順だけを持ち、
 * ドメインロジック（検索・編集）は一切持たない。chrome API の実体は `CleanupDeps` として
 * 呼び出し側（`services.ts`）が注入する（`AliasStore`/`TrashStore` と同じ最小契約 DI）。
 *
 * 掃除対象は以下の3種で、互いに独立して実行する（1つが失敗しても他は継続する）。
 * 1. `LocalState` に残った存在しないフォルダ/ブックマークID
 * 2. 対応するブックマークが消えた孤立 `AliasRecord`
 * 3. 保持日数を過ぎた/上限を超えたゴミ箱項目
 */

/**
 * 孤立した別名レコードを削除するまでの猶予期間（30日）。
 *
 * ブックマークの同期・復元（ゴミ箱からの復元、別端末での再作成）と競合して別名を巻き添えに消さないための
 * 保険。`AliasRecord.updatedAt` がこの期間内なら、孤立していても残す。ゴミ箱の既定保持日数（30日）と
 * そろえ、「ゴミ箱から復元できる間は別名も残っている」状態を保つ（データ損失ゼロの原則）。
 */
const ORPHAN_ALIAS_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/** ブックマークツリー上に現存する ID / URL の集合。 */
interface LiveIds {
  /** `url` を持たないノード（フォルダ）の ID。 */
  folderIds: Set<string>;
  /** `url` を持つノード（ブックマーク）の ID。 */
  bookmarkIds: Set<string>;
  /** `url` を持つノードの URL（重複を含む）。 */
  urls: string[];
}

/** ツリーを1回走査して現存 ID と URL を収集する。 */
const collectLiveIds = (nodes: readonly BookmarkNode[]): LiveIds => {
  const live: LiveIds = { folderIds: new Set(), bookmarkIds: new Set(), urls: [] };

  const walk = (node: BookmarkNode): void => {
    if (node.url === undefined) {
      live.folderIds.add(node.id);
    } else {
      live.bookmarkIds.add(node.id);
      live.urls.push(node.url);
    }
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);

  return live;
};

/**
 * `LocalState` から存在しない参照を落とした次状態を返す。変更が無ければ `null`（＝書き込み不要）。
 *
 * U19（状態復元）は読み出し時に既定値へフォールバックするが、保存値自体は掃除しない。特に
 * `expandedFolderIds` は `expandFolders` のマージで単調増加するため、ここで実体を刈り取る。
 */
const pruneLocalState = (state: LocalState, live: LiveIds): LocalState | null => {
  let changed = false;
  const next: LocalState = { ...state };

  const keptExpanded = state.expandedFolderIds.filter(id => live.folderIds.has(id));
  if (keptExpanded.length !== state.expandedFolderIds.length) {
    next.expandedFolderIds = keptExpanded;
    changed = true;
  }

  if (state.lastUsedFolderId !== undefined && !live.folderIds.has(state.lastUsedFolderId)) {
    delete next.lastUsedFolderId;
    changed = true;
  }

  if (state.session) {
    const session = { ...state.session };
    let sessionChanged = false;

    // 削除済みフォルダは「すべて」（null）へ倒す（`resolveRestoredScope` と同じ方針）。
    if (session.scopeFolderId !== null && !live.folderIds.has(session.scopeFolderId)) {
      session.scopeFolderId = null;
      sessionChanged = true;
    }
    // 削除済みブックマークはキーごと落とす（未指定＝先頭行の既定と等価にする）。
    if (session.selectedBookmarkId !== undefined && !live.bookmarkIds.has(session.selectedBookmarkId)) {
      delete session.selectedBookmarkId;
      sessionChanged = true;
    }

    if (sessionChanged) {
      next.session = session;
      changed = true;
    }
  }

  return changed ? next : null;
};

/**
 * 孤立（対応するブックマークが現存しない）かつ猶予期間を過ぎた別名レコードの URL を返す。
 *
 * @param records 全別名レコード
 * @param liveHashes 現存ブックマークの URL を `hashUrl` した集合
 * @param now 現在時刻（epoch ms）
 * @param graceMs 猶予期間（既定 `ORPHAN_ALIAS_GRACE_MS`）
 */
const selectOrphanAliasUrls = (
  records: Iterable<AliasRecord>,
  liveHashes: ReadonlySet<string>,
  now: number,
  graceMs: number = ORPHAN_ALIAS_GRACE_MS,
): string[] => {
  const orphans: string[] = [];
  for (const record of records) {
    if (liveHashes.has(record.urlHash)) {
      continue;
    }
    if (now - record.updatedAt < graceMs) {
      continue;
    }
    orphans.push(record.url);
  }
  return orphans;
};

/** `runStartupCleanup` が必要とする最小契約（テストではモックを注入する）。 */
interface CleanupDeps {
  bookmarks: { getTree(): Promise<BookmarkNode[]> };
  aliases: { getAll(): Promise<Map<string, AliasRecord>>; remove(url: string): Promise<void> };
  localState: { get(): Promise<LocalState>; set(value: LocalState): Promise<void> };
  settings: { get(): Promise<UserSettings> };
  trash: { purgeExpired(retentionDays: number): Promise<number>; enforceLimits(): Promise<number> };
  normalizer: { hashUrl(url: string): string };
  /** 現在時刻の取得（テストで固定するため差し替え可能にする）。 */
  now?: () => number;
}

/** クリーンアップ結果のサマリ（ログとテストの検証に使う）。 */
interface CleanupSummary {
  /** `LocalState` を書き換えたか。 */
  isLocalStateChanged: boolean;
  /** 削除した孤立別名レコードの件数。 */
  removedAliasCount: number;
  /** ゴミ箱から取り除いた項目の件数（期限切れ + 上限超過）。 */
  purgedTrashCount: number;
  /** ツリーを取得できなかった/空だったため掃除を行わなかったか。 */
  isSkipped: boolean;
}

/** 各ステップを独立して実行する（1つの失敗で他を止めない）。想定外は握り潰さずログに残す。 */
const runStep = async <T>(label: string, step: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await step();
  } catch (e) {
    // Service Worker のイベントハンドラが最上位のため伝播先が無い。ログに残して次回起動での再試行に委ねる
    // （クリーンアップは冪等）。外部送信はしない（プライバシー方針）。
    console.error(`[background] ${label}に失敗しました:`, e);
    return fallback;
  }
};

/**
 * ブラウザ起動時（`onStartup`）・インストール/更新時（`onInstalled`）のクリーンアップ本体。
 *
 * `getTree()` は1回だけ呼び、3ステップで使い回す（起動時の負荷を最小化する）。
 */
const runStartupCleanup = async (deps: CleanupDeps): Promise<CleanupSummary> => {
  const now = deps.now ?? Date.now;
  const summary: CleanupSummary = {
    isLocalStateChanged: false,
    removedAliasCount: 0,
    purgedTrashCount: 0,
    isSkipped: false,
  };

  // ツリーの取得と走査を同じステップで保護する。ここで例外が漏れると呼び出し側（`index.ts` の
  // `void runStartupTasks()`）で未処理の Promise 拒否になるため、収集まで含めて捕捉する。
  const live = await runStep(
    'ブックマークツリーの取得',
    async () => collectLiveIds(await deps.bookmarks.getTree()),
    null,
  );
  if (!live) {
    summary.isSkipped = true;
    return summary;
  }

  if (live.bookmarkIds.size === 0 && live.folderIds.size === 0) {
    // ツリーが空＝ブックマーク同期が未完了の可能性がある。実プロファイルは必ずルートフォルダ
    // （ブックマーク バー等）を持つため、この状態で掃除すると全参照を「存在しない」と誤判定し、
    // 別名を丸ごと消しかねない（データ損失ゼロの原則）。次回起動に委ねる。
    console.info('[background] ブックマークツリーが空のためクリーンアップをスキップしました');
    summary.isSkipped = true;
    return summary;
  }

  // --- step1: LocalState の存在しない参照を掃除する ---
  summary.isLocalStateChanged = await runStep(
    'ローカル状態のクリーンアップ',
    async () => {
      const state = await deps.localState.get();
      const pruned = pruneLocalState(state, live);
      if (!pruned) {
        return false;
      }
      await deps.localState.set(pruned);
      return true;
    },
    false,
  );

  // --- step2: 孤立した別名レコードを掃除する ---
  summary.removedAliasCount = await runStep(
    '孤立した別名レコードのクリーンアップ',
    async () => {
      if (live.bookmarkIds.size === 0) {
        // フォルダのみ（ブックマーク0件）の状態も同期未完了の疑いがあるため別名は触らない。
        return 0;
      }

      const liveHashes = new Set<string>();
      for (const url of live.urls) {
        try {
          liveHashes.add(deps.normalizer.hashUrl(url));
        } catch {
          // 絶対 URL でないもの（`javascript:` 等）は `new URL()` が TypeError を投げる。この URL は
          // `AliasStore.upsert` でも同じ理由で失敗し別名レコードを持ち得ないため、集合から漏れても
          // 孤立判定を誤らせない。
        }
      }

      const records = await deps.aliases.getAll();
      const orphanUrls = selectOrphanAliasUrls(records.values(), liveHashes, now());
      let removed = 0;
      for (const url of orphanUrls) {
        // 逐次実行する（`AliasStore` 内部でも直列化されるが、チャンクの読み書きを並行させない意図を明示する）。
        await deps.aliases.remove(url);
        removed++;
      }
      return removed;
    },
    0,
  );

  // --- step3: ゴミ箱の期限切れ・上限超過を掃除する ---
  summary.purgedTrashCount = await runStep(
    'ゴミ箱のクリーンアップ',
    async () => {
      // Options のゴミ箱タブを開かないユーザーでも「保持日数を過ぎたら自動削除」を成立させる（機能12）。
      const settings = await deps.settings.get();
      const expired = await deps.trash.purgeExpired(settings.trashRetentionDays);
      const overLimit = await deps.trash.enforceLimits();
      return expired + overLimit;
    },
    0,
  );

  if (summary.isLocalStateChanged || summary.removedAliasCount > 0 || summary.purgedTrashCount > 0) {
    console.info(
      `[background] クリーンアップ完了: ローカル状態=${summary.isLocalStateChanged ? '更新' : '変更なし'} / ` +
        `孤立別名=${summary.removedAliasCount}件 / ゴミ箱=${summary.purgedTrashCount}件`,
    );
  }

  return summary;
};

export { ORPHAN_ALIAS_GRACE_MS, collectLiveIds, pruneLocalState, selectOrphanAliasUrls, runStartupCleanup };
export type { CleanupDeps, CleanupSummary, LiveIds };
