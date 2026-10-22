# Finding your way (the menu, + Create, the phone bar, Find a page)

How a client gets around the dashboard. The menu is grouped by what you want to do, one big **+ Create** button starts
anything new, phones get a bar at the bottom, and **Find a page** finds any page by a word you know ("MoMo",
"Instagram", "photos").

**Where:** around every dashboard page. **Plans:** every plan. Each person only sees the pages their role and their
plan allow; a group with nothing left in it is not shown.

## The menu

On a computer the menu is on the left. On a phone it opens with **Menu** in the bottom bar (or the ☰ button at the top).

| Group | Pages |
|---|---|
| (top) | **+ Create**, then **Home** |
| My business | Business info, Brand |
| Create | Posts, Videos, Designs, Photos, Autopilot (and **Video Studio** when it is switched on) |
| Publish | Calendar, Channels, Link in bio |
| Customers | Inbox (a red number shows conversations with unread messages), Leads, Contacts, Automations, Website chat |
| Results | Analytics |
| Account & settings | Billing, Team, Usage, Settings, Connectors |

- **Account & settings** is folded. Tap its heading to open it; BuPulse remembers your choice on this device. It opens
  by itself when you are on one of its pages.
- **Add to your plan** (owners and admins) still lists the features your plan does not have.
- Names: the menu says **Posts** (the old "Content"), **Photos** (the old "Gallery") and **Business info** (the old
  "Knowledge base"). The page titles use the same names. The web addresses did not change, so old links still work.

## + Create

The **+ Create** button at the top of the menu (on a phone: the big round **+** in the middle of the bottom bar) opens
a short list:

| Action | Where it takes you |
|---|---|
| **New post** | General posts, with **Create today's content** already open: choose **AI makes it for me** or **I'll create it**. Without the calendar in the plan: the Posts page. |
| **New video** | The Video Studio in a new tab when it is available; otherwise your Videos library. |
| **New design** | Designs, where you pick a template or describe an image. |
| **Add photo** | Photos, asking where the new photos go; then your phone or computer opens its file picker. |

Only the actions your role and plan allow are listed. Close the list with **Esc**, or tap outside it.

## The phone bar

On a phone (and a tablet held upright) a bar stays at the bottom of every dashboard page: **Home**, **Calendar**, the
big **+**, **Inbox** and **Menu**. The page you are on is highlighted. Pages your plan does not have give their place
to another: without the Inbox, **Posts** is there instead; without the calendar, **Posts** takes its place. The bar
sits above the iPhone home line and works the same in the installed app (see
[32-phone-app-and-whatsapp-share.md](32-phone-app-and-whatsapp-share.md)). The page leaves room for it, so nothing
hides behind it, and messages that pop up appear above it.

## Find a page

The **Find a page** box is at the top of the menu, under the BuPulse logo. On a computer, **⌘K** (Mac) or **Ctrl+K** (Windows) opens it
from anywhere.

1. Type a page name or a word you know: "payment" or "MoMo" finds **Billing**, "photos" or "gallery" finds **Photos**,
   "chat" finds **Website chat** and **Inbox**, "Instagram" finds **Channels**, "knowledge" finds **Business info**.
2. Move with the up and down arrows, press **Enter** (or tap a line) to open it. **Esc** closes it.

It lists only the pages and Create actions you may open.

## For developers

- `components/app/nav.ts` — the one map: `NAV_GROUPS` (groups, items, `keywords` for the search), `navFor` (filtered by
  role and plan, empty groups dropped), `isActive` / `activeGroup`, `createActions` (+ Create), `bottomBarItems` (the
  phone bar with its fallbacks), `finderEntries` and `searchEntries` (Find a page). Pure; tested in
  `tests/navigation/nav.test.ts`. `NAV_ITEMS` (flat) is still exported for `tests/features/registry.test.ts`.
- `components/app/app-shell.tsx` — the sidebar and drawer (grouped, `FoldedGroup` with the `bp-nav-account-open`
  localStorage key in try/catch), the + Create button, the Find a page box, and the state for the menu, search and
  drawer (focus goes back to the button that opened each).
- `components/app/create-menu.tsx` (menu under the button on computers, sheet above the bar on phones; arrow keys,
  Esc, Tab, outside tap), `components/app/bottom-bar.tsx` (`data-bottom-bar`, safe-area padding, `aria-current`),
  `components/app/page-finder.tsx` (combobox + listbox, Cmd/Ctrl+K).
- Unread badge: `unreadCount` (lib/inbox/service.ts), one indexed count in `app/dashboard/layout.tsx`, only when the
  plan has the inbox.
- Entry points: `?create=1` on `/dashboard/content/general` opens `CreateDayContent` (`openOnAsk`, header button on
  today only); `?upload=1` on `/dashboard/gallery` opens the destination question in `GalleryView`. Both leave the
  address with `history.replaceState` once handled.
- `app/globals.css` — `.bp-sheet-in`, and `--bp-bottom-bar` (below `lg` when the bar is on the page) that lifts the
  toasts in `components/ui/toast.tsx`.

## If something goes wrong

| Symptom | Where to look | Usual fix |
|---|---|---|
| A page is missing from the menu | `NAV_GROUPS` permission, `featureForRoute` and the plan's features | Expected when the role or plan lacks it; otherwise add it to `NAV_GROUPS`. |
| Find a page does not know a word | `keywords` on the item in `nav.ts` | Add the word and a test in `tests/navigation/nav.test.ts`. |
| Something hides behind the phone bar | the shell's `max-lg:pb-[…]` in `app-shell.tsx` | Fixed or sticky elements of a page need their own bottom offset (`var(--bp-bottom-bar)`). |
| Account & settings does not stay open | localStorage refused (private window) | It then stays open only until the page is reloaded; nothing to fix. |
| Inbox badge looks old | The layout counts on a full page load | Reload; opening a conversation clears its unread count. |
