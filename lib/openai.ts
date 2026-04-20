export async function judgeDebate(args: {
  topic: string;
  player1Username: string;
  player2Username: string;
  player1Side: string;
  player2Side: string;
  player1Transcript: string;
  player2Transcript: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const prompt = `
You are judging a 1v1 competitive debate.

Topic:
${args.topic}

Player 1: ${args.player1Username}
Side: ${args.player1Side}
Transcript:
${args.player1Transcript}

Player 2: ${args.player2Username}
Side: ${args.player2Side}
Transcript:
${args.player2Transcript}

Judge the debate based on:
- relevance to the topic
- argument strength
- rebuttal quality
- clarity
- persuasiveness

Return valid JSON only in this format:
{
  "winner": "player1" or "player2",
  "reason": "short explanation in 2-4 sentences"
}
`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a strict debate judge. Return only valid JSON with no markdown.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No model response");
  }

  return JSON.parse(content) as {
    winner: "player1" | "player2";
    reason: string;
  };
}