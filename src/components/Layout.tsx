"use client";

import Sidebar from "./Sidebar";
import BottomNav from "./BottomNav";
import { useEffect, useState } from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);

    // Listen for sidebar toggle events
    const onStorage = (e: StorageEvent) => {
      if (e.key === "sidebar-collapsed") setCollapsed(e.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
