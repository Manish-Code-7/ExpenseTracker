"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Home", icon: HomeIcon },
  { href: "/transactions", label: "Activity", icon: ListIcon },
  { href: "/transactions/new", label: "Add", icon: PlusIcon, primary: true },
  { href: "/chat", label: "Assistant", icon: ChatIcon },
  { href: "/accounts", label: "Accounts", icon: WalletIcon },
];

function isActive(pathname: string, href: string) {
  if (href === "/transactions") {
    return pathname === "/transactions" || pathname.startsWith("/transactions/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line-strong bg-[color-mix(in_oklab,var(--backdrop)_62%,transparent)] backdrop-blur-2xl md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {TABS.map(({ href, label, icon: Icon, primary }) => {
          const active = primary
            ? pathname === "/transactions/new"
            : isActive(pathname, href) && pathname !== "/transactions/new";
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  active ? "text-ink" : "text-ink-muted"
                }`}
              >
                {primary ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-paper">
                    <Icon />
                  </span>
                ) : (
                  <Icon />
                )}
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const links = [
    ...TABS.filter((t) => !t.primary),
    { href: "/recurring", label: "Recurring", icon: RepeatIcon, primary: false },
    { href: "/categories", label: "Categories", icon: TagIcon, primary: false },
  ];

  return (
    <nav aria-label="Main" className="hidden md:block">
      <ul className="flex items-center gap-1">
        {links.map(({ href, label }) => {
          const active = isActive(pathname, href) && pathname !== "/transactions/new";
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-ink text-paper"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* --- icons: 20px, 1.6 stroke, no dependency ---------------------------- */

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function HomeIcon() {
  return (
    <svg {...base}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg {...base}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...base} width={18} height={18} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...base}>
      <path d="M20.5 12.5c0 4-3.8 7-8.5 7a10 10 0 0 1-2.6-.34L4 21l1.2-3.5A6.6 6.6 0 0 1 3.5 12.5c0-4 3.8-7 8.5-7s8.5 3 8.5 7Z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16.5 14.5h.01" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg {...base}>
      <path d="M4 9a5 5 0 0 1 5-5h11" />
      <path d="m17 1 3 3-3 3" />
      <path d="M20 15a5 5 0 0 1-5 5H4" />
      <path d="m7 23-3-3 3-3" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg {...base}>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <path d="M7.5 7.5h.01" />
    </svg>
  );
}
