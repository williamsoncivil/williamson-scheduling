"use client";

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import { useEffect, useState } from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Read initial state
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);

    // Listen for same-tab toggle events dispatched by Sidebar
    const onToggle = (e: Event) => {
      setCollapsed((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed);
    };
    window.addEventListener("sidebar-toggle", onToggle);
    return () => window.removeEventListener("sidebar-toggle", onToggle);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <BottomNav />
      <main
        className={`pb-20 md:pb-0 min-h-screen transition-all duration-300 ${
          collapsed ? "md:ml-16" : "md:ml-64"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
