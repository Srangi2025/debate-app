export type DebateTopic = {
  id: string;
  title: string;
  category: string;
};

export const TOPICS: DebateTopic[] = [
  { id: "ai-harm", title: "AI does more harm than good", category: "Technology" },
  { id: "free-college", title: "College should be free", category: "Education" },
  { id: "remote-work", title: "Remote work should remain the norm", category: "Work" },
  { id: "mandatory-voting", title: "Voting should be mandatory", category: "Politics" },
  { id: "social-media", title: "Social media does more harm than good", category: "Society" },
  { id: "death-penalty", title: "The death penalty should be abolished", category: "Law" },
  { id: "universal-basic-income", title: "Universal basic income should be adopted", category: "Economics" },
  { id: "space-funding", title: "Governments should spend more on space exploration", category: "Science" },
  { id: "school-uniforms", title: "School uniforms should be required", category: "Education" },
  { id: "censorship", title: "Online censorship is sometimes justified", category: "Technology" },
  { id: "animal-testing", title: "Animal testing should be banned", category: "Ethics" },
  { id: "crypto", title: "Cryptocurrency is a net positive for society", category: "Finance" },
];

export function normalizeTopics(topics: string[]): string[] {
  return [...new Set(
    topics
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
  )].sort();
}

export function topicsKey(topics: string[]): string {
  return normalizeTopics(topics).join("|");
}