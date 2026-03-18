"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/jobs", label: "Jobs", icon: "🏗️" },
  { href: "/schedule", label: "Schedule", icon: "📅" },
  { href: "/schedule/gantt", label: "Gantt", icon: "📊" },
  { href: "/schedule/timeline", label: "Timeline", icon: "👤" },
  { href: "/files", label: "Files", icon: "📄" },
  { href: "/messages", label: "Messages", icon: "💬" },
  { href: "/people", label: "People", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/schedule") return pathname === "/schedule";
    return pathname.startsWith(href);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
      <div className="flex overflow-x-auto px-1 py-1 landscape:py-0.5 gap-0.5" style={{ WebkitOverflowScrolling: "touch", scrollbarWidth: "none" }}>
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex flex-col items-center gap-0.5 px-3 py-2 landscape:py-1 rounded-lg transition-colors shrink-0 min-h-[44px] justify-center ${
              isActive(link.href)
                ? "text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <span className="text-lg landscape:text-base leading-none">{link.icon}</span>
            <span className="text-[10px] font-medium whitespace-nowrap landscape:hidden">{link.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
