import { Suspense } from "react";
import QueueClient from "./QueueClient";

export const dynamic = "force-dynamic";

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="min-h-screen p-8">Loading queue...</div>}>
      <QueueClient />
    </Suspense>
  );
}