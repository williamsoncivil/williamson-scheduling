"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/jobs", label: "Jobs", icon: "🏗️" },
  { href: "/schedule", label: "Schedule", icon: "📅" },
  { href: "/people", label: "People", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function BottomNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/schedule") return pathname === "/schedule";
    return pathname.startsWith(href);
  };

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-inset-bottom">
      <div className="flex justify-around px-1 py-1 landscape:py-0.5">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex flex-col items-center gap-0.5 px-2 py-2 landscape:py-1 rounded-lg transition-colors min-w-0 flex-1 ${
              isActive(link.href)
                ? "text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <span className="text-lg landscape:text-base">{link.icon}</span>
            <span className="text-[10px] font-medium truncate landscape:hidden">{link.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
