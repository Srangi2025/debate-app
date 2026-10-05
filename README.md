This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Install dependencies with `npm install`. Configure Supabase anonymous sign-in in
`.env.local` using `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Matchmaking also needs Redis. To use a Redis server running on your Mac, add:

```dotenv
REDIS_URL=redis://127.0.0.1:6379
```

`REDIS_URL` takes precedence over `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. Keep the local Redis server running while testing.
For a deployed app, use a reachable Redis service; leave `REDIS_URL` unset to use
the Upstash REST credentials.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

To test a match, open the dashboard in a regular browser window and a separate
incognito or guest window. Enter a username in each, select the same set of
topics, and join the queue. Two tabs in the same browser session share a guest
identity and cannot match each other.

After debating, each player submits a transcript or summary. The first submission
is saved and cannot be replaced; that player waits until the opponent submits.
Both players then see the same saved result. Scoring currently uses response
length as a temporary rule, with equal lengths awarded to Player 1. AI judging
and rating updates are not connected yet.

Run the match-completion regression tests with `npm run test:matches` using
Node.js 22.18 or newer and local Redis. Set `REDIS_TEST_URL` if your test Redis
uses a different address. Tests create and remove their own isolated records.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
