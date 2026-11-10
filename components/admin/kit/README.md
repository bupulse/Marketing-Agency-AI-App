# Admin UI kit

The pieces the redesigned admin console is built from (owner, 10 Nov 2026: "easy to navigate, no need to put too much
information on one page, use cards that hover or create new pages, like support.bupulse.com"). Import from
`@/components/admin/kit` (or the single file). Everything here works in **server components** (pages stay server
components); only `ExpandCard`'s open/close part runs in the browser.

See them all with made-up data at **`/admin/preview/kit`** (dev only), plus `/admin/preview` (Overview) and
`/admin/preview/hub?group=money` (a hub). `?role=finance` (or `sales_agent`, `support`, `marketing`, `it`...) shows what
that role sees.

## The rules of the look

- **Cards:** white `bg-surface` on the grey page, `rounded-[22px]`, `border-line`, soft shadow. Use the `CARD` class
  string from `tones.ts` for your own cards so they match. Links that are cards add `LIFT` (hover lift, off under
  reduced motion) and `FOCUS` (focus ring).
- **One tone per area:** Sales orange, Clients blue, Money green, Live chat teal, Content pink, AI violet, System slate,
  Organisation indigo (`group.tone` in `components/admin/nav.ts`). Use the area's tone for its icon badges.
- **A plain line under every heading and number.** Say what it is and what to do, in words a shop owner uses.
- **Less on one page.** A section with a lot inside becomes a `SectionCard` to its own page, or an `ExpandCard`.
- **Choices are chips or tiles, not selects.** `FilterChips` / `ChoiceTiles` (URL based).
- **Phones first:** check every page at 390 px. Lists use `DataList` (cards on a phone).
- **Keep every `requirePermission(...)`.** A new sub-page calls the same permission as the page it came from.
- Add `<KitStyles />` once on a page that uses `SectionGrid`, `StatGrid` or `TodoList` outside the console shell (the
  shell already renders it), for the gentle rise-in animation.

## Pieces

### `PageHeader`

The top of a page: gradient icon badge, title, one-line description, main buttons on the right (under the title on a
phone), optional small eyebrow and back link. Use it instead of `PageHeader` from `components/app` on redesigned pages.

```tsx
<PageHeader
  icon={Smartphone}
  tone="green"
  title="Payments"
  description="Mobile Money payments to confirm, and the payment details clients see."
  back={{ href: "/admin/money", label: "Money" }}
  actions={<Link href="/admin/payments/settings" className={buttonClasses({ variant: "secondary" })}>Payment details</Link>}
/>
```

### `SectionCard` and `SectionGrid`

A card that opens another page: icon badge, title, hint (2 lines max), one key number with a few words, and a red
to-do bubble. Hover lifts it and shows the brand accent. `row` turns it into a slim row on a phone (good for long lists
of cards). Use these to split a long page into a hub + sub-pages.

```tsx
<SectionGrid>
  <SectionCard href="/admin/payments/waiting" icon={Smartphone} tone="green" title="Waiting for you" hint="Payments clients say they made. Check, then approve or reject." value="3" valueLabel="to check" count={3} countLabel="3 payments to check" row />
  <SectionCard href="/admin/payments/details" icon={Settings} tone="green" title="Payment details" hint="The MoMo number and name clients see." row />
</SectionGrid>
```

`SectionGrid cols={2|3|4}` (default 3); pass `className="grid-cols-2"` for two small cards a row on a phone.

### `HubView`

A whole hub page from a nav group: header + one `SectionCard` per page the viewer may open. The group hubs use it
(`app/admin/(console)/hub/hub-content.tsx`). Pass a group already filtered with `navFor(me.permissions)`.

```tsx
<HubView group={mine} figures={{ "/admin/payments": { count: 2, countLabel: "2 to check", value: "2", valueLabel: "payments to check" } }} />
```

### `StatTile` and `StatGrid`

A number with its meaning: icon badge, label, big value, optional change (`delta`, "Up 12% vs October" in words, green
when good news; `upIsGood: false` for costs and errors), optional sparkline, a one-line hint, and `href` to make the
whole tile a link. `alert` rings it red (something to act on).

```tsx
<StatGrid cols={4}>
  <StatTile icon={Coins} tone="green" label="Revenue this month" value={fx.amount(cents)} hint="Money that came in since the 1st." delta={{ now: cents, before: prev, against: "vs October" }} spark={series} href="/admin/revenue" />
  <StatTile icon={Smartphone} tone="green" label="Payments to confirm" value="2" alert hint="Mobile Money payments to check." href="/admin/payments" />
</StatGrid>
```

`StatGrid` is two tiles a row on a phone; pass `className="grid-cols-1 sm:grid-cols-2"` for long money values.

### `ExpandCard`

A card with a one-line summary that opens its details on **hover (mouse), tap, and keyboard focus**. The header is a
real button with `aria-expanded`; links inside open it while focused. Use it for "details on demand" (a breakdown, a
how-it-works, rarely needed settings).

```tsx
<ExpandCard icon={Users} tone="blue" title="Clients" summary="34 paying · 9 on trial · 2 past due" aside={<StatusPill tone="bad">2 late</StatusPill>}>
  <div className="grid grid-cols-2 gap-3">...</div>
</ExpandCard>
```

`defaultOpen` starts it open (do this when something inside needs attention).

### `FilterChips` and `ChoiceTiles` (+ `hrefWith`, `chosen`)

Filters as links: each chip goes to the same page with one URL parameter changed (others kept; `notice`, `error` and
paging dropped). The page reads the choice with `chosen()` and stays a server component. The chosen one has a ring, a
tick and `aria-current`. Chips scroll sideways on a phone. `ChoiceTiles` are bigger, with an icon and a hint each.

```tsx
const sp = await searchParams;
const status = chosen(sp, "status", ["waiting", "approved", "rejected"], "");
<FilterChips label="Show payments" param="status" base="/admin/payments" params={sp} current={status}
  options={[{ value: "", label: "All", count: 12 }, { value: "waiting", label: "Waiting", count: 3 }, { value: "approved", label: "Approved" }]} />
<ChoiceTiles label="Period" param="range" base="/admin/ai" params={sp} current={range} allValue="30d"
  options={[{ value: "today", label: "Today", hint: "Since midnight", icon: Sun, tone: "orange" }, { value: "30d", label: "30 days", hint: "The last month" }]} />
```

`allValue` is the option that means "no filter" (its link removes the parameter).

### `DataList`

Records as a **table on a computer and cards on a phone**, from one list of columns. `primary` is the title column (bold,
first on a card, the link when `rowHref` is given); `hideOnPhone` keeps cards short; `align: "right"` for numbers.

```tsx
<DataList
  caption="Companies"
  rows={companies}
  rowKey={(c) => c.id}
  rowHref={(c) => `/admin/companies/${c.id}`}
  columns={[
    { key: "name", header: "Company", cell: (c) => c.name, primary: true },
    { key: "status", header: "Status", cell: (c) => <StatusPill tone="good" dot>Active</StatusPill> },
    { key: "mrr", header: "Pays a month", cell: (c) => fx.amount(c.mrrCents), align: "right" },
    { key: "seen", header: "Last seen", cell: (c) => c.lastSeen, hideOnPhone: true },
  ]}
  empty={<EmptyState title="No company matches." hint="Pick another filter above." />}
/>
```

The cells render twice (table and cards; CSS hides one), so keep forms with `id`s out of cells, or pass `mode="table"`.
In a client component, `DataList` works the same.

### `TodoList`

"Needs you": tappable rows (icon, sentence, optional sub line, count, arrow) with a coloured edge: `bad` (broken or
overdue), `warn` (waiting for someone), `info`. `limit` shows the first few and folds the rest behind "Show N more";
`columns={2}` uses two columns on a wide screen. Says kindly when empty.

```tsx
<TodoList limit={6} columns={2} items={[{ key: "quotes", href: "/admin/quotes", icon: PhoneCall, tone: "bad", text: "3 quote requests to call", sub: "They expect a call.", count: 3 }]} empty={{ title: "Nothing needs you right now." }} />
```

### `StatusPill` and `CountBubble`

`StatusPill tone="good|warn|bad|info|new|muted"` with `dot` or `icon`: a state in words (never colour alone).
`CountBubble count={3} label="3 payments to check"`: the red to-do bubble (nothing at zero).

### `EmptyState`

Icon, short title, one line on why or what to do, optional button. `tone="good"` for good news.

```tsx
<EmptyState icon={Smartphone} title="No payments waiting." hint="New Mobile Money payments appear here as clients report them." />
```

### `Breadcrumbs` and `BackLink`

The shell already shows breadcrumbs from `nav.ts` (the group links to its hub), so pages rarely need them. `BackLink`
is a small pill "Back to ..." link for sub-pages (or use `PageHeader`'s `back`).

### `IconBadge`

A white icon on a tone gradient (`size="sm|md|lg"`). Decorative: always next to text that says the same.

## The older pieces (`components/admin/ui.tsx`)

`Panel`, `Section`, `Stat`, `HowCalculated`, `Empty`, `TableWrap`/`Th`/`Td`, `RangeTabs` and the `notice` class strings
keep their props and now have the new look, so unchanged pages already match. New in them: `Panel` takes optional
`icon`, `tone` and `id`; `notice` also has `info` and `warn`. Prefer the kit for new layouts; keep using `Panel` for a
titled block of content and `notice.ok` / `notice.bad` for `?notice=` / `?error=` messages.

## Navigation (`components/admin/nav.ts`)

- Each group has `hub` (its card page), `hint` (one line) and `tone`. Hubs: `/admin/money`, `/admin/clients`,
  `/admin/system`, and `/admin/hub/sales`, `/admin/hub/content`, `/admin/hub/ai`, `/admin/hub/organisation` (their short
  paths are taken by pages). Live chat has one page and no hub.
- `hubPermissions(group)`: any permission that opens one of the group's pages. A hub route calls
  `requirePermission(hubPermissions(group))` and shows only the cards the viewer may open.
- `groupHref(group)`: where a group leads one person (straight to the page when they may open only one).
- `phoneTabsFor(permissions)`: the phone tab bar (Overview, Inbox, Clients, Sales when allowed).
- When you split a page into sub-pages, add the sub-pages under the page's `href` (so `findNavItem` keeps the sidebar
  item active and the breadcrumbs right), keep the old URL working (a hub of `SectionCard`s, or a redirect that keeps
  `?notice=` and `?error=`), and update `revalidatePath` calls.
