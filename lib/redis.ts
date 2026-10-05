import { Redis, type Requester, type UpstashRequest } from "@upstash/redis";
import IORedis from "ioredis";

function createRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  // Reuse TCP connections across Next.js development reloads and route modules.
  const shared = globalThis as typeof globalThis & {
    debateRedisConnections?: Map<string, IORedis>;
  };
  const connections = (shared.debateRedisConnections ??= new Map());
  let connection = connections.get(url);
  if (!connection) {
    connection = new IORedis(url, {
      lazyConnect: true,
      connectTimeout: 3000,
      commandTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    // Request failures are handled by the route calling Redis.
    connection.on("error", () => {});
    connections.set(url, connection);
  }
  const tcp = connection;

  // Keep the same command serialization and JSON decoding as the Upstash client.
  const requester: Requester = {
    async request<TResult>({ body }: UpstashRequest) {
      const [command, ...args] = body as [string, ...(string | number)[]];
      const result = await tcp.call(command, ...args);
      return { result: result as TResult };
    },
  };
  return new Redis(requester);
}

export const redis = createRedis();
