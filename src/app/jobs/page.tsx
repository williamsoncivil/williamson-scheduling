"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import CopyJobModal from "@/components/CopyJobModal";
import Link from "next/link";

interface Job {
  id: string;
  name: string;
  address: string;
  status: "ACTIVE" | "COMPLETED" | "ARCHIVED";
  color: string;
  createdAt: string;
  _count: { phases: number; schedules: number };
}

const statusBadge = {
  ACTIVE: "bg-green-100 text-green-800",
  COMPLETED: "bg-blue-100 text-blue-800",
  ARCHIVED: "bg-gray-100 text-gray-600",
};

export default function JobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [copyModal, setCopyModal] = useState<{ id: string; name: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const archiveJob = async (job: Job) => {
    const newStatus = job.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED";
    const label = newStatus === "ARCHIVED" ? "Archive" : "Unarchive";
    if (!confirm(`${label} "${job.name}"?`)) return;
    setArchivingId(job.id);
    await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setArchivingId(null);
    fetchJobs(showArchived);
  };

  const fetchJobs = async (archived = false) => {
    setLoading(true);
    const url = archived ? "/api/jobs?status=archived" : "/api/jobs";
    const res = await fetch(url);
    const data = await res.json();
    setJobs(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchJobs(showArchived);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
            <p className="text-gray-500 text-sm mt-0.5">{jobs.length} {showArchived ? "archived" : "active"} projects</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Archived toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setShowArchived(false)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${!showArchived ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                Active
              </button>
              <button
                onClick={() => setShowArchived(true)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${showArchived ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
              >
                Archived
              </button>
            </div>
            <Link href="/jobs/new">
              <button className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                + New Job
              </button>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-400 text-center py-12">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">{showArchived ? "📦" : "🏗️"}</div>
            <p className="text-gray-500">
              {showArchived ? "No archived jobs." : "No jobs yet. Create your first project."}
            </p>
            {!showArchived && (
              <Link href="/jobs/new">
                <button className="mt-4 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-blue-700">
                  Create Job
                </button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <div key={job.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                <div className="h-2" style={{ backgroundColor: job.color }} />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <h2
                      className="font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors leading-tight"
                      onClick={() => router.push(`/jobs/${job.id}`)}
                    >
                      {job.name}
                    </h2>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-2 shrink-0 ${statusBadge[job.status]}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">{job.address}</p>
                  <div className="flex items-center gap-4 text-xs text-gray-400 mb-4">
                    <span>📋 {job._count.phases} phases</span>
                    <span>📅 {job._count.schedules} entries</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/jobs/${job.id}`)}
                      className="flex-1 text-center text-sm font-medium text-blue-600 border border-blue-200 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
                    >
                      View
                    </button>
                    {job.status !== "ARCHIVED" && (
                      <button
                        onClick={() => setCopyModal({ id: job.id, name: job.name })}
                        className="flex-1 text-center text-sm font-medium text-gray-600 border border-gray-200 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Copy
                      </button>
                    )}
                    <button
                      onClick={() => archiveJob(job)}
                      disabled={archivingId === job.id}
                      className={`flex-1 text-center text-sm font-medium py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                        job.status === "ARCHIVED"
                          ? "text-green-700 border border-green-200 hover:bg-green-50"
                          : "text-gray-500 border border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {archivingId === job.id ? "…" : job.status === "ARCHIVED" ? "Unarchive" : "Archive"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {copyModal && (
        <CopyJobModal
          isOpen={true}
          sourceJobId={copyModal.id}
          sourceJobName={copyModal.name}
          onClose={() => setCopyModal(null)}
          onSuccess={(newId) => {
            setCopyModal(null);
            fetchJobs(showArchived);
            router.push(`/jobs/${newId}`);
          }}
        />
      )}
    </Layout>
  );
}
