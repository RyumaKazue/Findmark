# Findmark Privacy Policy

- **Applies to**: the Chrome extension "Findmark" (version 1.0.0 and later)
- **Last updated**: 2026-08-14

## Summary

**Findmark collects and transmits no data.** Your bookmarks, aliases, search terms, and settings never leave your browser. No third party — including the developer — can see them.

## Information we collect

**None.** Findmark does not do any of the following:

- Collect personally identifiable information (name, email address, postal address, etc.)
- Collect browsing history or the content of pages you visit
- Transmit your search terms, aliases, or bookmarks anywhere
- Measure usage (telemetry, analytics) or send crash reports
- Serve ads or perform advertising-related tracking
- Identify users through cookies or similar technologies

## What the extension handles, and where it is stored

To provide its features, Findmark handles the following **inside your browser only**.

| Data | Purpose | Stored in |
|---|---|---|
| Chrome bookmarks (title, URL, folder structure) | Searching and organizing (rename, move, delete, add) | Chrome's bookmarks (Findmark keeps no separate copy) |
| Aliases | Finding bookmarks by names you choose | `chrome.storage.sync` (falls back to `chrome.storage.local` when the quota is exceeded) |
| Settings (display language, trash retention period) | Extension configuration | `chrome.storage.sync` |
| Trash (deleted bookmarks and their aliases) | Undoing deletions (30 days by default) | `chrome.storage.local` |
| Popup state (focus position, folder scope, selected row, query) | Restoring your working state on next launch | `chrome.storage.local` |
| Title and URL of the current tab | Saving the current page when you press [+ Add] | Handled transiently (persisted only as a bookmark) |

Data stored in `chrome.storage.sync` is **shared between devices signed in to the same Google account through Chrome's own sync mechanism** when Chrome sync is enabled. That is a standard Chrome browser feature; Findmark does not send it to any server of its own.

## External communication

Findmark performs **no communication with external servers**. It contains no `fetch`, `XMLHttpRequest`, or WebSocket requests to remote hosts, and it requests no host permissions. All fonts and icons used by the interface ship inside the extension package; nothing is loaded from a CDN or any other external source.

Favicons are read through the `favicon` permission from the copies Chrome already stores locally — Findmark never connects to the sites themselves.

## Why each permission is requested

| Permission | Reason |
|---|---|
| `bookmarks` | To search your bookmarks and to rename, edit URLs, move, delete, add, and restore them |
| `storage` | To store aliases, settings, trash, and popup state inside your browser |
| `activeTab` | To read the title and URL of the current tab when you press [+ Add] |
| `favicon` | To display each site's icon in the search results |

## Sharing with third parties

Because no data is collected, there is **no sharing, selling, or transfer to third parties of any kind**.

## Deleting your data

The aliases, settings, and trash that Findmark stores are removed when you uninstall the extension from Chrome. Individual trash entries can be deleted at any time from the "Trash" tab of the options page. Your bookmarks themselves are managed by Chrome and are not removed when the extension is uninstalled.

## Children's privacy

Findmark can be used at any age and collects no information from any user.

## Changes to this policy

If this policy changes, the "Last updated" date above is revised and the updated version is linked from the Chrome Web Store listing.

## Contact

- GitHub: https://github.com/RyumaKazue/Findmark
