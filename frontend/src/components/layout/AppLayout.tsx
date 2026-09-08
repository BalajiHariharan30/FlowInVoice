import React from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Navbar } from "./Navbar";

export const AppLayout: React.FC = () => {
  return (
    <div className="min-h-screen bg-obsidian-950 text-slate-100 flex relative overflow-x-hidden">
      {/* Ambient background aurora glows */}
      <div className="fixed top-0 left-64 right-0 h-96 bg-gradient-to-b from-emerald-500/[0.04] via-indigo-500/[0.02] to-transparent pointer-events-none -z-0"></div>
      <div className="fixed -top-40 right-20 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -z-0"></div>
      <div className="fixed top-1/2 left-80 w-80 h-80 bg-purple-500/[0.06] rounded-full blur-3xl pointer-events-none -z-0"></div>

      <Sidebar />
      <div className="flex-1 ml-64 flex flex-col min-h-screen relative z-10">
        <Navbar />
        <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
