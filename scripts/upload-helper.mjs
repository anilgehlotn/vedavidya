// Test helper: uploads a file the way the browser does (resumable pieces), returns the /complete response.
export async function upload(API, token, buf, filename, purpose, { chunk } = {}) {
  const h = { Authorization: `Bearer ${token}` };
  const start = await fetch(`${API}/uploads`, { method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ filename, size: buf.length, purpose }) });
  const s = await start.json().catch(() => null);
  if (start.status !== 200) return { status: start.status, data: s, stage: "start" };
  const size = chunk ?? s.chunk_bytes;
  for (let o = 0; o < buf.length; o += size) {
    const r = await fetch(`${API}/uploads/${s.id}?offset=${o}`, { method: "PUT", headers: { ...h, "Content-Type": "application/octet-stream" }, body: buf.subarray(o, o + size) });
    if (r.status !== 200) return { status: r.status, data: await r.json().catch(() => null), stage: "chunk", id: s.id };
  }
  const done = await fetch(`${API}/uploads/${s.id}/complete`, { method: "POST", headers: h });
  return { status: done.status, data: await done.json().catch(() => null), stage: "complete", id: s.id };
}

/** Uploads several files and returns their upload ids (throws if any fails). */
export async function uploadAll(API, token, files, purpose) {
  const ids = [];
  for (const [name, buf] of files) {
    const r = await upload(API, token, buf, name, purpose);
    if (r.status !== 200) throw new Error(`upload ${name}: ${r.status} ${JSON.stringify(r.data)}`);
    ids.push(r.data.id);
  }
  return ids;
}

/** Waits until no sheet of the test is still being processed. */
export async function waitProcessed(API, token, testId, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const d = await (await fetch(`${API}/tests/${testId}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (!d.attempts.some((a) => a.processing) && !(d.uploads ?? []).some((u) => u.status === "queued" || u.status === "processing")) return d;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timed out waiting for sheets to be processed");
}

/** Waits for a document to finish processing. */
export async function waitDocument(API, token, id, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const d = await (await fetch(`${API}/documents/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json();
    if (d.status === "completed" || d.status === "failed") return d;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timed out waiting for document");
}
