"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TOPICS } from "@/lib/topics";

export default function DashboardPage() {
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [username, setUsername] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("debate_username");
    if (saved) setUsername(saved);
  }, []);

  const toggleTopic = (topicId: string) => {
    setSelectedTopics((prev) =>
      prev.includes(topicId)
        ? prev.filter((id) => id !== topicId)
        : prev.length < 5
        ? [...prev, topicId]
        : prev
    );
  };

  const selectedCount = useMemo(() => selectedTopics.length, [selectedTopics]);

  const saveUsername = () => {
    const trimmed = username.trim();
    if (!trimmed) return;
    localStorage.setItem("debate_username", trimmed);
    setUsername(trimmed);
  };

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="mt-2 text-lg text-gray-600">
              Select up to 5 debate topics, then join the ranked queue.
            </p>
          </div>

          <Link
            href="/"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
          >
            ← Home
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="w-full max-w-md">
              <label className="text-sm font-medium text-gray-700">
                Username
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter a username"
                  className="w-full rounded-lg border px-4 py-3 outline-none focus:border-black"
                />
                <button
                  onClick={saveUsername}
                  className="rounded-lg bg-black px-4 py-3 text-white"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="rounded-full border px-4 py-2 text-sm">
              Selected topics: {selectedCount}/5
            </div>
          </div>

          <div className="mt-6">
            <p className="text-lg font-semibold">
              {username.trim() || "DemoUser"}
            </p>
            <p className="text-sm text-gray-600">Rating: 1000 · Record: 0-0</p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {TOPICS.map((topic) => {
              const active = selectedTopics.includes(topic.id);

              return (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => toggleTopic(topic.id)}
                  className={`rounded-xl border p-4 text-left transition ${
                    active
                      ? "border-black bg-black text-white"
                      : "border-gray-300 bg-white text-black hover:border-black"
                  }`}
                >
                  <p className="text-xs uppercase tracking-wide opacity-70">
                    {topic.category}
                  </p>
                  <p className="mt-1 font-medium">{topic.title}</p>
                </button>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href={{
                pathname: "/queue",
                query: {
                  topics: selectedTopics.join(","),
                },
              }}
              className={`rounded-lg px-6 py-3 text-white ${
                selectedTopics.length > 0 && username.trim()
                  ? "bg-black"
                  : "pointer-events-none bg-gray-400"
              }`}
            >
              Join Queue
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}