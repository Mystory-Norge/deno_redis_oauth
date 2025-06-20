import { Redis } from 'ioredis';
const REDIS_URL_KEY = 'REDIS_URL';
let redisUrl = undefined;
if ((await Deno.permissions.query({ name: 'env', variable: REDIS_URL_KEY })).state === 'granted') {
  redisUrl = Deno.env.get(REDIS_URL_KEY);
}
const redis = new Redis(redisUrl || 'redis://localhost:6379');
await redis.connect();

// Gracefully shutdown after tests
addEventListener('beforeunload', async () => {
  await redis.quit();
});

export interface OAuthSession {
  state: string;
  codeVerifier: string;
  successUrl: string;
}

function oauthSessionKey(id: string): string {
  return ['oauth_sessions', id].join(':');
}
async function getJson<T>(key: string, del = false): Promise<T | null> {
  const res = await (del ? redis.getdel : redis.get)(key);
  if (res === null) {
    return null;
  }
  try {
    return JSON.parse(res);
  } catch (e) {
    return null;
  }
}
async function setJson(key: string, value: any, options?: { expireIn?: number }) {
  const jsonValue = JSON.stringify(value);
  if (options?.expireIn) {
    await redis.set(key, jsonValue, 'EX', options.expireIn);
  } else {
    await redis.set(key, jsonValue);
  }
}

export async function getAndDeleteOAuthSession(id: string): Promise<OAuthSession> {
  const key = oauthSessionKey(id);
  const oauthSession = await getJson<OAuthSession>(key, true);
  if (oauthSession === null) {
    throw new Deno.errors.NotFound('OAuth session not found');
  }
  // If the session was found, it is deleted by getJson with del=true
  return oauthSession;
}

export async function setOAuthSession(
  id: string,
  value: OAuthSession,
  /**
   * OAuth session entry expiration isn't included in unit tests as it'd
   * require a persistent and restartable KV instance. This is difficult to do
   * in this module, as the KV instance is initialized top-level.
   */
  options: { expireIn: number }
) {
  await setJson(oauthSessionKey(id), value, options);
}

/**
 * The site session is created on the server. It is stored in the database to
 * later validate that a session was created on the server. It has no purpose
 * beyond that. Hence, the value of the site session entry is arbitrary.
 */
type SiteSession = true;

function siteSessionKey(id: string): string {
  return ['site_sessions', id].join(':');
}

export async function isSiteSession(id: string): Promise<boolean> {
  const res = await getJson<SiteSession>(siteSessionKey(id));
  return res !== null;
}

export async function setSiteSession(id: string, expireIn?: number) {
  await setJson(siteSessionKey(id), true, { expireIn });
}

export async function deleteSiteSession(id: string) {
  await redis.del(siteSessionKey(id));
}
