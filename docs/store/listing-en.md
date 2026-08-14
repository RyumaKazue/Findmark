# Chrome Web Store listing (English)

- **Document**: store/listing-en
- **Target**: Findmark 1.0.0 (initial submission)
- **Purpose**: Values to enter in the Chrome Web Store Developer Dashboard "Store listing" tab
- **Sources**: [product-requirements.md](../product-requirements.md) / [architecture.md](../architecture.md) / [mvp-development-flow.md](../mvp-development-flow.md)

> The Japanese version is [listing-ja.md](./listing-ja.md). Both versions — especially the permission explanations — must stay in sync.

---

## Extension name

```
Findmark
```

> The manifest `name` resolves from `__MSG_extensionName__` (`_locales/en/messages.json`).

## Short description (max 132 characters)

```
A bookmark search extension you find by your own aliases. No dictionaries—just your own names for instant results. Zero external communication.
```

> Identical to the manifest `description` (`extensionDescription` in `_locales/en/messages.json`). **Change both together.**

## Category

```
Productivity
```

## Languages

```
Japanese (default) / English
```

## Detailed description

```
Findmark makes "what was that page called again?" a thing of the past.

Give any bookmark your own aliases, and you can pull it up in seconds by the name you actually use — not the title the site happens to have. Call your invoice template "invoice", your internal wiki "wiki", or anything else. Add as many aliases as you like.

■ Features
・Search by your own aliases: results narrow with every keystroke, ignoring differences in case and (for Japanese) full-width/half-width and hiragana/katakana
・Fully keyboard driven: move between the search box, folder tree, and result list with the arrow keys, and press Enter to open
・Scope by folder: pick a folder on the left to search only what sits directly inside it
・Organize in place: rename, fix a URL, delete, or move to another folder right from the result row
・Bulk actions: select several bookmarks and move or delete them at once
・Save the current page: the [+ Add] button bookmarks the page you are on and lets you add aliases immediately
・Deletion you can take back: a 5-second undo right after deleting, plus a 30-day trash you can restore from
・Take it with you: import and export in Findmark's own JSON format (aliases included) or in the standard HTML bookmarks format

■ Privacy
・No communication with any external server. Search, aliases, and settings stay entirely inside your browser
・No browsing history collection, no usage reporting, no ads, no analytics
・Aliases and settings are stored in Chrome's sync storage, so they follow you across devices signed in to the same Google account

■ About the permissions
・Read and change your bookmarks: needed to search your bookmarks and to rename, move, delete, and add them
・Read the icons of the websites you visit: needed to show each site's favicon in the result list (the favicon permission; it does not give access to page content or browsing history)
・Storage: used to keep your aliases, settings, and trash inside your browser
・activeTab: used only when you press [+ Add], to read the title and URL of the page you currently have open

■ About the launch shortcut
The default shortcut is Ctrl+Shift+F (Command+Shift+F on Mac). If another extension already claimed those keys, Chrome may leave the shortcut unassigned at install time. When that happens, the Settings tab of the options page tells you about it — open chrome://extensions/shortcuts and assign any key you like.

■ Requirements
Chrome (Manifest V3). Available in Japanese and English.
```

## Single purpose

```
Let users search their bookmarks by aliases they choose themselves, and organize those bookmarks in place.
```

## Permission justification

Entered in the dashboard's "Privacy practices" tab. Maps one-to-one to the four entries in the manifest `permissions`.

| Permission | Install-time warning | Justification to submit |
|---|---|---|
| `bookmarks` | "Read and change your bookmarks" | Required to read the bookmarks being searched and to rename, edit URLs, move, delete, create, and restore them. |
| `storage` | none | Required to store the aliases the user creates, their settings (display language, trash retention), deleted items (trash), and popup state inside the browser. |
| `activeTab` | none | Required to read the title and URL of the currently open tab when the user presses [+ Add] so it can be saved as a bookmark. Page content is never read. |
| `favicon` | "Read the icons of the websites you visit" | Required to display each site's favicon in the result rows. It only reads icons Chrome already holds locally; no external requests are made. |

- **Host permissions**: none requested (no `content_scripts`, no `host_permissions`).
- **Remote code**: none (all scripts and fonts ship inside the extension package).

## Data usage disclosures (Privacy practices)

- User data collected: **none** (declare "not collected" for every category)
- Purpose of use: n/a
- Sold or transferred to third parties: no
- Privacy policy URL: the published URL of [privacy-policy-en.md](./privacy-policy-en.md) (hosting location decided at submission time)

## Screenshots

Follow the capture scenarios in [screenshots.md](./screenshots.md) (1280×800, five images).

## Support

- Source code / contact: https://github.com/RyumaKazue/Findmark
