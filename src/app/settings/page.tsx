"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Layout from "@/components/Layout";

interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EMPLOYEE" | "SUBCONTRACTOR";
  phone: string | null;
}

const roleBadge: Record<string, string> = {
  ADMIN: "bg-purple-100 text-purple-800",
  EMPLOYEE: "bg-blue-100 text-blue-800",
  SUBCONTRACTOR: "bg-orange-100 text-orange-800",
};

export default function SettingsPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<User>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  // New user form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "EMPLOYEE" | "SUBCONTRACTOR">("EMPLOYEE");
  const [newPhone, setNewPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState(false);

  // Subcontractor form
  const [subName, setSubName] = useState("");
  const [subTrade, setSubTrade] = useState("");
  const [subPhone, setSubPhone] = useState("");
  const [creatingSub, setCreatingSub] = useState(false);
  const [subError, setSubError] = useState("");
  const [subSuccess, setSubSuccess] = useState(false);

  const fetchUsers = async () => {
    const res = await fetch("/api/people");
    const data = await res.json();
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const isAdmin = session?.user?.role === "ADMIN";

  const deleteUser = async (user: User) => {
    if (!confirm(`Are you sure you want to remove ${user.name}?`)) return;
    setDeletingId(user.id);
    setDeleteError("");
    try {
      const res = await fetch(`/api/people/${user.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setDeleteError(data.error || "Failed to delete user");
        return;
      }
      fetchUsers();
    } catch {
      setDeleteError("Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  };

  const saveEdit = async (id: string) => {
    await fetch(`/api/people/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditingId(null);
    fetchUsers();
  };

  const createSubcontractor = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingSub(true);
    setSubError("");
    setSubSuccess(false);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: subName, trade: subTrade || null, phone: subPhone || null, role: "SUBCONTRACTOR" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add subcontractor");
      }
      setSubName(""); setSubTrade(""); setSubPhone("");
      setSubSuccess(true);
      setTimeout(() => setSubSuccess(false), 3000);
      fetchUsers();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Failed to add subcontractor");
    } finally {
      setCreatingSub(false);
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    setCreateSuccess(false);

    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          email: newEmail,
          password: newPassword,
          role: newRole,
          phone: newPhone || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create user");
      }

      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("EMPLOYEE");
      setNewPhone("");
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
      fetchUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">Manage team members and access</p>
        </div>

        {!isAdmin && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
            <p className="text-yellow-800 text-sm">⚠️ You need Admin access to manage users.</p>
          </div>
        )}

        {/* User list */}
        <div className="bg-white rounded-xl shadow-sm mb-6">
          <div className="p-5 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Team Members</h2>
          </div>
          {deleteError && (
            <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {deleteError}
              <button onClick={() => setDeleteError("")} className="ml-2 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}
          {loading ? (
            <div className="p-5 text-gray-400">Loading...</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {users.map((user) => (
                <div key={user.id} className="p-4">
                  {editingId === user.id ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Name</label>
                        <input
                          type="text"
                          value={editData.name ?? user.name}
                          onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Email</label>
                        <input
                          type="email"
                          value={editData.email ?? user.email}
                          onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Role</label>
                        <select
                          value={editData.role ?? user.role}
                          onChange={(e) => setEditData({ ...editData, role: e.target.value as "ADMIN" | "EMPLOYEE" | "SUBCONTRACTOR" })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="EMPLOYEE">EMPLOYEE</option>
                          <option value="SUBCONTRACTOR">SUBCONTRACTOR</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Phone</label>
                        <input
                          type="tel"
                          value={editData.phone ?? user.phone ?? ""}
                          onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="sm:col-span-2 flex gap-3">
                        <button onClick={() => setEditingId(null)} className="border border-gray-300 text-gray-700 py-2 px-3 rounded-lg text-sm hover:bg-gray-50">
                          Cancel
                        </button>
                        <button onClick={() => saveEdit(user.id)} className="bg-blue-600 text-white py-2 px-3 rounded-lg text-sm hover:bg-blue-700">
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {user.name[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900 truncate">{user.name}</p>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${roleBadge[user.role]}`}>
                            {user.role}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 truncate">{user.email}</p>
                        {user.phone && <p className="text-xs text-gray-400">{user.phone}</p>}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            onClick={() => {
                              setEditingId(user.id);
                              setEditData({});
                            }}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            Edit
                          </button>
                          {user.id !== session?.user?.id && (
                            <button
                              onClick={() => deleteUser(user)}
                              disabled={deletingId === user.id}
                              className="text-sm text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              {deletingId === user.id ? "Deleting…" : "Delete"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Subcontractor */}
        {isAdmin && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border-l-4 border-orange-400">
            <h2 className="font-semibold text-gray-900 mb-1">Add Subcontractor</h2>
            <p className="text-sm text-gray-500 mb-4">No login required — subcontractors appear in scheduling but can't access the app.</p>
            {subSuccess && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">✓ Subcontractor added</div>}
            {subError && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{subError}</div>}
            <form onSubmit={createSubcontractor} className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={subName} onChange={(e) => setSubName(e.target.value)} required placeholder="John Smith" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trade / Company <span className="text-gray-400">(optional)</span></label>
                <input type="text" value={subTrade} onChange={(e) => setSubTrade(e.target.value)} placeholder="Framing, Electrical…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-gray-400">(optional)</span></label>
                <input type="tel" value={subPhone} onChange={(e) => setSubPhone(e.target.value)} placeholder="360-555-0100" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div className="sm:col-span-3">
                <button type="submit" disabled={creatingSub} className="bg-orange-500 text-white py-2 px-6 rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors disabled:opacity-50">
                  {creatingSub ? "Adding..." : "Add Subcontractor"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Add new user */}
        {isAdmin && (
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Add Team Member</h2>

            {createSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
                ✓ User created successfully
              </div>
            )}
            {createError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {createError}
              </div>
            )}

            <form onSubmit={createUser} className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "ADMIN" | "EMPLOYEE" | "SUBCONTRACTOR")}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ADMIN">Admin</option>
                  <option value="EMPLOYEE">Employee</option>
                  <option value="SUBCONTRACTOR">Subcontractor</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-gray-400">(optional)</span></label>
                <input
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="360-555-0100"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="bg-blue-600 text-white py-2 px-6 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Add Team Member"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
