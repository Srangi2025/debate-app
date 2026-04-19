const players = [
  { rank: 1, username: "DebateKing", rating: 1288, record: "14-3" },
  { rank: 2, username: "AlexR", rating: 1210, record: "10-4" },
  { rank: 3, username: "DemoUser", rating: 1016, record: "1-0" },
  { rank: 4, username: "LogicFlow", rating: 998, record: "3-3" },
  { rank: 5, username: "CivicMind", rating: 972, record: "2-4" },
];

export default function LeaderboardPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-10 text-black">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-4xl font-bold">Global Leaderboard</h1>
        <p className="mt-3 text-lg text-gray-600">
          Top ranked debaters across all topics.
        </p>

        <div className="mt-8 overflow-hidden rounded-2xl border">
          <div className="grid grid-cols-4 bg-black px-6 py-4 text-sm font-semibold text-white">
            <div>Rank</div>
            <div>Username</div>
            <div>Rating</div>
            <div>Record</div>
          </div>

          {players.map((player) => (
            <div
              key={player.rank}
              className="grid grid-cols-4 border-t px-6 py-4 text-sm"
            >
              <div>#{player.rank}</div>
              <div>{player.username}</div>
              <div>{player.rating}</div>
              <div>{player.record}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}