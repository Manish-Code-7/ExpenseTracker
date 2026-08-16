# Ledger — personal expense tracker

Track what you spend **and which card, UPI handle or wallet you spent it from**.
Every payment method carries a colour you pick, and that colour follows it into
the expense list, the dashboard and every chart, so you can scan spend by card
at a glance.

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Neon Postgres · Drizzle ORM ·
tRPC · Better Auth · Zod · Recharts · installable PWA.

---

## Setup

Roughly ten minutes.

### 1. Create the database

1. [console.neon.tech](https://console.neon.tech) → **New project**, region closest to you.
2. **Connect** → copy the **pooled** connection string.

### 2. Fill in `.env.local`

```bash
cp .env.local.example .env.local
openssl rand -base64 32        # paste as BETTER_AUTH_SECRET
```

Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
Optional: `RESEND_API_KEY` (password-reset email), `GOOGLE_CLIENT_ID`/`SECRET`
(Google sign-in), `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` (the assistant).

Restart `npm run dev` after any change — Next reads env at boot.

### 3. Run the SQL

Apply the schema to your Neon branch:

```bash
npx drizzle-kit migrate     # uses DATABASE_URL
```

Then paste these into the **Neon SQL Editor** and run them:

| File | What it does | Required? |
|---|---|---|
| `neon/02_functions.sql` | Integrity triggers + recurring detection | Yes |
| `neon/03_rls.sql` | Row Level Security via `pg_session_jwt` + JWKS | Optional |

See `neon/README.md` for the RLS/JWKS walkthrough.

> **`relation "..." does not exist`** means the migration hasn't been applied to
> the branch `DATABASE_URL` points at. Check the Neon **Tables** view.

### 4. Configure auth

Email and password work as soon as `BETTER_AUTH_SECRET` is set — Better Auth
serves everything at `/api/auth/*` and stores users in your own database.

**Password reset** needs an email sender. Set `RESEND_API_KEY` and `EMAIL_FROM`
([resend.com/api-keys](https://resend.com/api-keys)). Without a key the app still
runs and the email is printed to the server console instead — fine locally, not
fine in production.

**Google sign-in** *(optional)*:

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services
   → OAuth consent screen**. While it's in *Testing*, add your own email under
   **Test users** or sign-in is refused.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Authorised redirect URI: `http://localhost:3000/api/auth/callback/google`
   (and the same on your real domain).
4. Put the client ID and secret in `.env.local`.

> Sign in with Apple was dropped in the Neon migration. Supabase brokered it;
> doing it directly needs a paid Apple Developer account and your own key.

### 5. Schedule recurring detection *(optional)*

The **Recurring** page's **Scan now** button runs detection on demand, so this
is only about keeping patterns fresh unattended. `pg_cron` isn't available the
way it was on Supabase — point a Vercel Cron or GitHub Action at an endpoint
that calls `detect_recurring_patterns_all()`.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Sign up, and you'll land on an empty dashboard with preset categories and a
single **Cash** payment method already created. Add your cards in **Wallet**
first — every expense needs one.

```bash
npm run build && npm start   # production build
npm run lint
```

---

## How it's put together

```
src/
  proxy.ts                  Bounces signed-out users to /login (optimistic cookie check)
  server/
    auth.ts                 Better Auth: email+password, Google, JWT/JWKS for Neon RLS
    email.ts                Resend sender for reset + confirmation mail
    session.ts              requireUser() for server components
    db/                     Drizzle schema, Neon clients, signup seeding, detection
    trpc/                   Context + routers (the only place writes happen)
  lib/
    trpc.tsx                React Query + tRPC client provider
    schemas.ts              Zod schemas — validation, form types, and the LLM tool
    dates.ts                yyyy-mm-dd date maths, incl. credit card statement cycles
    dashboard.ts            All dashboard aggregation, in one place
    queries.ts              Shared reads (categories, methods) + the expense join
  app/
    login, signup           Email+password, plus Google
    forgot-password,        Request a reset link / choose a new password
      reset-password
    api/auth/[...all]       Better Auth (sign-in, OAuth callback, JWKS)
    api/trpc/[trpc]         Every read and write the client makes
    (app)/                  Everything behind auth — shares the nav shell
      account/              Your details: name, date of birth, gender
      dashboard/            Month total, by-method, by-category, limits, cycles, upcoming
      expenses/             List + filters + pagination, add, edit
      methods/              The wallet: add / edit / archive
      categories/           Presets + your own; hide rather than delete
      recurring/            Confirm or dismiss detected patterns
neon/                       Migrations, integrity functions, and the RLS/JWKS setup
public/                     manifest.json, sw.js, generated icons
```

### Some decisions worth knowing about

**Glass panels, colour in the backdrop.** Frosted surfaces float over a fixed
ambient field of three soft washes (`.ambient` in `globals.css`) — without
something to refract, frosted glass just reads as grey. The panels themselves
stay near-neutral so a payment method's `color_tag` is still the loudest thing
on screen; that's what makes spend scannable by colour. The category chart is
deliberately achromatic and identifies bars by their axis labels.

Glass degrades on purpose: `@supports not (backdrop-filter)` and
`prefers-reduced-transparency: reduce` both fall back to solid panels with the
same layout, and ink stays at full opacity so contrast holds over whatever
drifts underneath.

**Spend-by-method and budget progress are separate sections.** The bar chart puts
every method on one shared rupee axis, so bar lengths are directly comparable.
Progress meters are each scaled to *their own* limit. Drawing both on one axis
would give every bar a different scale and quietly mislead.

**Credit card cycles don't reset on the 1st.** Set a statement day on a credit
card and the dashboard shows what's accrued since the last statement — the
number that actually lands on your next bill — alongside the calendar-month view.

**Archive beats delete.** Removing a payment method or category that expenses
already point at archives or hides it instead, so your history keeps its colours
and names. Outright deletion only happens when nothing references it.

**Dates are plain `yyyy-mm-dd` strings end to end.** No `Date` objects in the
data path, so an expense logged on the 1st in IST never slides into last month
because the server runs in UTC.

### How recurring detection works

Rule-based, no ML. A group of expenses is flagged when **all** of these hold:

- same `category_id` + `subcategory_id` + `payment_method_id` + note fingerprint
  (lowercased first word of the note — "Netflix Aug 2025" and "netflix, august"
  both collapse to `netflix`)
- at least **3** occurrences in the last 400 days
- every amount within **±10%** of the group average
- every gap between consecutive occurrences within **±3 days** of the median gap

Tying the group to `payment_method_id` is what separates your Netflix charge on
one card from an unrelated one-off Bills expense on another.

Confidence blends occurrence count, how tight the amounts are, and how tight the
intervals are. Your confirm/dismiss decisions are never overwritten by a later
scan; only untouched suggestions get cleaned up when they stop qualifying.

To make detection more or less eager, change `p_min_occurrences` (default 3) or
the `±10%` / `±3 days` thresholds in `detect_recurring_patterns`.

### Profile details

`public.profiles` holds one row per user — `full_name`, `date_of_birth`,
`gender`, `avatar_url` — created by the same trigger that seeds categories, and
pre-filled from whatever Google or Apple hands over.

**Age is derived from `date_of_birth`, not stored.** A stored age is wrong from
the user's next birthday onward and nothing would ever correct it; `ageFrom()`
in `src/lib/profile.ts` computes it on read. `gender` is free text with
suggested options plus a self-describe field, rather than a locked enum.

### PWA

`public/manifest.json` plus a small `public/sw.js`, registered in production
only. The service worker caches build output and icons, and shows `/offline`
when the network is gone — it **never** caches your pages or any database
response, since both are personal and behind auth.

Install it: open the deployed site on your phone → Share/menu → **Add to Home
Screen**. Installability needs HTTPS, so it works on your deployed URL, not on
`http://localhost` from another device.

---

## Deploying

Push to GitHub and import into Vercel. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`,
and `BETTER_AUTH_URL` (your real origin — emails and OAuth callbacks are built
from it), plus `RESEND_API_KEY` / `EMAIL_FROM` for password reset. If you use
Google sign-in, add the production redirect URI
`https://your-domain.com/api/auth/callback/google` in the Google Cloud Console.
