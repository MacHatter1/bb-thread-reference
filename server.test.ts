import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

let disposeCurrent: (() => Promise<void>) | undefined;

afterEach(async () => {
  await disposeCurrent?.();
  disposeCurrent = undefined;
});

describe("thread mention provider", () => {
  it("resolves a source thread into bounded agent context", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "thread-reference",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "th_source",
              projectId: "proj_source",
              title: "Source thread",
            }),
          conversationOutline: async () => ({
            items: [
              {
                id: "msg_1",
                role: "user" as const,
                preview: "Please inspect this source thread.",
                attachmentSummary: null,
              },
              {
                id: "msg_2",
                role: "assistant" as const,
                preview: "The source thread contains useful context.",
                attachmentSummary: null,
              },
            ],
            maxSeq: 2,
          }),
        },
      },
    });
    disposeCurrent = harness.lifecycle.dispose;

    await plugin(bb);
    const provider = harness.inspection.registrations.mentionProviders.find(
      (candidate) => candidate.id === "thread-reference",
    );
    if (provider === undefined) throw new Error("mention provider was not registered");

    const resolved = await provider.resolve("th_source");
    expect(resolved.context).toContain("Thread title: Source thread");
    expect(resolved.context).toContain("Project id: proj_source");
    expect(resolved.context).toContain("Assistant: The source thread contains useful context.");
    expect(resolved.context).toContain("untrusted reference material");
  });
});
