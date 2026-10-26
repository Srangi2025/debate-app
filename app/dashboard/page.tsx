"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TOPICS } from "@/lib/topics";
import { useGuestProfile } from "@/app/components/GuestProfile";

function UsernameForm({ saving, setSaving }: { saving: boolean; setSaving: (value: boolean) => void }) {
  const { username: savedUsername, loading: profileLoading, saveUsername: persistUsername } = useGuestProfile();
  const [username, setUsername] = useState(savedUsername ?? "");
  const [nameError, setNameError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");

  const saveUsername = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmed = username.trim();
    setSavedNotice("");
    setNameError("");
    if (!trimmed || trimmed.length > 100) {
      setNameError("Enter a name between 1 and 100 characters.");
      return;
    }
    setSaving(true);
    try {
      await persistUsername(trimmed);
      setUsername(trimmed);
      setSavedNotice(`Name saved. You'll appear as ${trimmed} in debates.`);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : "Your name could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={saveUsername} className="w-full max-w-md">
      <label htmlFor="username" className="text-sm font-medium text-gray-700">
        Username
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setNameError(""); setSavedNotice(""); }}
          maxLength={100}
          autoComplete="nickname"
          disabled={profileLoading || saving}
          aria-invalid={!!nameError}
          aria-describedby="username-feedback"
          placeholder="Enter a username"
          className="w-full rounded-lg border px-4 py-3 outline-none focus:border-black"
        />
        <button
          type="submit"
          disabled={profileLoading || saving}
          className="rounded-lg bg-black px-4 py-3 text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : savedUsername && username.trim() === savedUsername ? "Saved ✓" : "Save"}
        </button>
      </div>
      <div id="username-feedback" className="mt-3 min-h-5 text-sm">
        {nameError ? <p role="alert" className="text-red-700">{nameError}</p> : (
          <p role="status" className={savedNotice ? "text-emerald-700" : "text-gray-500"}>
            {savedNotice || (savedUsername && username.trim() !== savedUsername
              ? `Unsaved changes. You're still saved as ${savedUsername}.`
              : savedUsername ? `Name saved. You'll appear as ${savedUsername} in debates.` : "This is the name your opponent will see.")}
          </p>
        )}
      </div>
    </form>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const { username: savedUsername, loading: profileLoading, error: profileError } = useGuestProfile();
  const [saving, setSaving] = useState(false);
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

  const handleJoinQueue = () => {
    if (!savedUsername || selectedTopics.length === 0 || saving) return;
    router.push(`/queue?topics=${encodeURIComponent(selectedTopics.join(","))}`);
  };

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="mt-2 text-lg text-gray-600">
              Save your name, choose up to 5 topics, and find an opponent.
            </p>
          </div>

          <Link
            href="/"
            className="shrink-0 whitespace-nowrap rounded-lg border px-4 py-2 text-sm hover:bg-gray-100"
          >
            ← Home
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border p-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <UsernameForm key={JSON.stringify(savedUsername)} saving={saving} setSaving={setSaving} />

            <div className="rounded-full border px-4 py-2 text-sm">
              Selected topics: {selectedCount}/5
            </div>
          </div>

          {profileError && <p role="alert" className="mt-4 text-sm text-red-700">{profileError}</p>}

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
            <button
              onClick={handleJoinQueue}
              disabled={!savedUsername || profileLoading || saving || selectedTopics.length === 0}
              className={`rounded-lg px-6 py-3 text-white ${
                selectedTopics.length > 0 && savedUsername && !saving && !profileLoading
                  ? "bg-black"
                  : "cursor-not-allowed bg-gray-400"
              }`}
            >
              Join Queue
            </button>
            <p className="self-center text-sm text-gray-600">
              {savedUsername ? `You'll join as ${savedUsername}.` : "Save your name to join a debate."}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
