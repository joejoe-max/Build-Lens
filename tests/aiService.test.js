import test from "node:test";
import assert from "node:assert/strict";
import { askBuildLens } from "../src/services/ai.js";

const encoder = new TextEncoder();

function mockFetch(response) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  return () => { globalThis.fetch = original; };
}

test("frontend consumes the versioned SSE contract and applies model events", async () => {
  const events = [
    'event: status\ndata: {"message":"Reading drawings"}\n\n',
    'event: delta\ndata: {"text":"The "}' + '\n\n',
    'event: delta\ndata: {"text":"model is ready."}\n\n',
    'event: model\ndata: {"actions":[{"type":"model.replace"}],"model":{"id":"test"},"findings":[]}\n\n',
    'event: done\ndata: {"answer":"The model is ready.","actions":[{"type":"model.replace"}],"model":{"id":"test"},"findings":[]}\n\n'
  ].join("");
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(events)); controller.close(); }
  });
  const restore = mockFetch(new Response(stream, { status: 200, headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-BuildLens-Protocol": "sse-v1"
  }}));
  const deltas = [], statuses = [], actions = [];
  try {
    const answer = await askBuildLens({
      message: "Generate a 3D model",
      onDelta: value => deltas.push(value),
      onStatus: value => statuses.push(value),
      onActions: value => actions.push(value)
    });
    assert.equal(answer, "The model is ready.");
    assert.deepEqual(deltas, ["The ", "The model is ready.", "The model is ready."]);
    assert.deepEqual(statuses, ["Reading drawings"]);
    assert.equal(actions.length, 1);
    assert.equal(actions[0].model.id, "test");
  } finally { restore(); }
});

test("frontend accepts a JSON response when the API returns JSON instead of SSE", async () => {
  const restore = mockFetch(new Response(JSON.stringify({
    answer: "JSON fallback answer",
    actions: [{ type: "model.replace" }],
    model: { id: "json-model" },
    findings: []
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const actions = [];
  try {
    const answer = await askBuildLens({ message: "Generate model", onActions: value => actions.push(value) });
    assert.equal(answer, "JSON fallback answer");
    assert.equal(actions[0].model.id, "json-model");
  } finally { restore(); }
});

test("frontend surfaces JSON API errors without trying to parse them as SSE", async () => {
  const restore = mockFetch(new Response(JSON.stringify({ error: "META_API_KEY is missing" }), {
    status: 503, headers: { "Content-Type": "application/json" }
  }));
  try {
    await assert.rejects(
      askBuildLens({ message: "Hello" }),
      /META_API_KEY is missing/
    );
  } finally { restore(); }
});
