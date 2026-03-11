"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState, useEffect } from "react";

const navLinks = [
  { href: "/", label: "Dashboard", icon: "🏠" },
  { href: "/jobs", label: "Jobs", icon: "🏗️" },
  { href: "/schedule", label: "Schedule", icon: "📅" },
  { href: "/schedule/gantt", label: "Gantt Chart", icon: "📊" },
  { href: "/schedule/timeline", label: "People Timeline", icon: "👤" },
  { href: "/files", label: "Files", icon: "📁" },
  { href: "/people", label: "People", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  // Persist collapse state
  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem("sidebar-collapsed", String(!prev));
      return !prev;
    });
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/schedule") return pathname === "/schedule";
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`hidden md:flex fixed left-0 top-0 h-full flex-col z-50 bg-slate-800 transition-all duration-300 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Logo + toggle */}
      <div className="p-3 border-b border-slate-700 flex items-center justify-between min-h-[64px]">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔨</span>
            <div>
              <h1 className="text-white font-bold text-sm leading-tight">Williamson</h1>
              <h2 className="text-slate-400 text-xs">Scheduling</h2>
            </div>
          </div>
        )}
        {collapsed && <span className="text-2xl mx-auto">🔨</span>}
        <button
          onClick={toggle}
          className="ml-auto text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg p-1.5 transition-colors text-xs font-bold"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            title={collapsed ? link.label : undefined}
            className={`flex items-center gap-3 px-2 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors ${
              collapsed ? "justify-center" : ""
            } ${
              isActive(link.href)
                ? "bg-blue-600 text-white"
                : "text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            <span className="text-base">{link.icon}</span>
            {!collapsed && <span>{link.label}</span>}
          </Link>
        ))}
      </nav>

      {/* User / sign out */}
      <div className="p-3 border-t border-slate-700">
        {!collapsed && session?.user && (
          <div className="mb-3">
            <p className="text-white text-sm font-medium truncate">{session.user.name}</p>
            <p className="text-slate-400 text-xs truncate">{session.user.email}</p>
            <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
              {session.user.role}
            </span>
          </div>
        )}
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          title="Sign out"
          className={`w-full text-left text-slate-400 hover:text-white text-sm transition-colors px-2 py-2 rounded-lg hover:bg-slate-700 flex items-center gap-2 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <span>🚪</span>
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );
}
