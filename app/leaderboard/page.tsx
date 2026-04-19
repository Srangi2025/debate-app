"use client";

import { useEffect, useState } from "react";

type LeaderboardPlayer = {
  rank: number;
  userId: string;
  username: string;
  rating: number;
};

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<LeaderboardPlayer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch("/api/leaderboard");
        const data = await res.json();
        setPlayers(data.players || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-4xl font-bold">Global Leaderboard</h1>
        <p className="mt-3 text-lg text-gray-600">
          Top ranked debaters across all topics.
        </p>

        {loading ? (
          <p className="mt-8">Loading leaderboard...</p>
        ) : (
          <div className="mt-8 overflow-hidden rounded-2xl border">
            <div className="grid grid-cols-3 bg-black px-6 py-4 text-sm font-semibold text-white">
              <div>Rank</div>
              <div>Username</div>
              <div>Rating</div>
            </div>

            {players.length === 0 ? (
              <div className="px-6 py-6 text-sm text-gray-600">
                No players yet.
              </div>
            ) : (
              players.map((player) => (
                <div
                  key={player.userId}
                  className="grid grid-cols-3 border-t px-6 py-4 text-sm"
                >
                  <div>#{player.rank}</div>
                  <div>{player.username}</div>
                  <div>{player.rating}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </main>
  );
}