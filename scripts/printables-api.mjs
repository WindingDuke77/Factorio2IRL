// Minimal GraphQL helpers for the public Printables API (works without login).
const ENDPOINT = 'https://api.printables.com/graphql/';
const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://www.printables.com',
  Referer: 'https://www.printables.com/',
  'User-Agent': 'Mozilla/5.0',
};

export async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Printables API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Printables API: ${json.errors.map((e) => e.message).join('; ')}`);
  return json.data;
}

/** All model sets of a user, with their STL file lists. */
export async function listUserModels(userId = '@WubeSoftware', limit = 50) {
  const data = await gql(`query ($userId: ID!, $limit: Int!) {
    userModels(userId: $userId, limit: $limit) {
      items { id name slug license { name } stls { id name folder fileSize } }
    }
  }`, { userId, limit });
  return data.userModels.items;
}

/** Temporary direct download URL for one STL of a set. */
export async function getDownloadLink(stlId, setId) {
  const data = await gql(`mutation ($id: ID!, $printId: ID!) {
    getDownloadLink(id: $id, printId: $printId, fileType: stl, source: model_detail) {
      ok errors { field messages } output { link ttl }
    }
  }`, { id: String(stlId), printId: String(setId) });
  const r = data.getDownloadLink;
  if (!r.ok || !r.output?.link) {
    throw new Error(`getDownloadLink(${stlId}) failed: ${JSON.stringify(r.errors)}`);
  }
  return r.output.link;
}
