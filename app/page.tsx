import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-white text-black">
      <div className="text-center">
        <h1 className="text-5xl font-bold">Ranked Debate</h1>
        <p className="mt-4 text-lg">
          Queue up. Get a topic. Defend your side.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-black px-6 py-3 text-white"
        >
          Start Debating
        </Link>
      </div>
    </main>
  );
}