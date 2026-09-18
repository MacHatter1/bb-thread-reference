// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import {
  THREAD_REFERENCE_MIME,
  parseThreadReferenceMentionResource,
  parseThreadReferencePayload,
  serializeThreadReferencePayload,
} from "../src/shared.js";

function fakeDataTransfer() {
  const values = new Map<string, string>();
  const transfer = {
    dropEffect: "none",
    effectAllowed: "all",
    getData(type: string) {
      return values.get(type) ?? "";
    },
    setData(type: string, value: string) {
      values.set(type, value);
    },
    get types() {
      return Array.from(values.keys());
    },
  } as unknown as DataTransfer;
  return transfer;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("thread reference payloads", () => {
  it("round-trips a bounded, normalized payload", () => {
    const raw = serializeThreadReferencePayload({
      threadId: "th_source",
      label: "  A\nsource thread  ",
    });
    expect(parseThreadReferencePayload(raw)).toEqual({
      threadId: "th_source",
      label: "A source thread",
    });
  });

  it("rejects malformed or oversized payloads", () => {
    expect(parseThreadReferencePayload("not json")).toBeNull();
    expect(parseThreadReferencePayload(JSON.stringify({ threadId: "" }))).toBeNull();
    expect(
      parseThreadReferencePayload(
        JSON.stringify({ threadId: "th_source", label: "x".repeat(5_000) }),
      ),
    ).toBeNull();
  });

  it("parses only this plugin's persisted mention resources", () => {
    expect(
      parseThreadReferenceMentionResource(
        JSON.stringify({
          kind: "plugin",
          pluginId: "thread-reference",
          itemId: "thread-reference:th_source",
          label: "Source thread",
        }),
      ),
    ).toEqual({ threadId: "th_source", label: "Source thread" });
    expect(
      parseThreadReferenceMentionResource(
        JSON.stringify({
          kind: "plugin",
          pluginId: "other-plugin",
          itemId: "thread-reference:th_source",
        }),
      ),
    ).toBeNull();
  });
});

describe("plugin app", () => {
  it("adds a dedicated drag handle without making the whole row draggable", async () => {
    const rowContainer = document.createElement("div");
    const row = document.createElement("a");
    row.dataset.sidebarThreadId = "th_source";
    row.setAttribute("draggable", "true");
    row.textContent = "Source thread";
    rowContainer.append(row);
    document.body.append(rowContainer);

    const app = await loadPluginApp(() => import("../src/app"));
    const mounted = await mountPluginContentScripts(app, {
      pluginId: "thread-reference",
    });

    expect(row.draggable).toBe(false);
    const handle = rowContainer.querySelector<HTMLElement>(
      "[data-bb-thread-reference-handle]",
    );
    expect(handle).not.toBeNull();
    expect(handle?.draggable).toBe(true);
    expect(handle?.classList.contains("size-7")).toBe(true);
    expect(handle?.classList.contains("z-20")).toBe(true);
    expect(handle?.querySelector("svg")).not.toBeNull();
    expect(handle?.querySelectorAll("circle")).toHaveLength(6);
    const transfer = fakeDataTransfer();
    const dragStart = new Event("dragstart", { bubbles: true });
    Object.defineProperty(dragStart, "dataTransfer", { value: transfer });
    handle?.dispatchEvent(dragStart);
    expect(parseThreadReferencePayload(transfer.getData(THREAD_REFERENCE_MIME))).toEqual({
      threadId: "th_source",
      label: "Source thread",
    });

    await mounted.lifecycle.dispose();
    expect(row.draggable).toBe(true);
    expect(rowContainer.querySelector("[data-bb-thread-reference-handle]")).toBeNull();
  });

  it("does not render a visible drop banner", async () => {
    const app = await loadPluginApp(() => import("../src/app"));
    const banner = app.composerCustomizations[0]?.banners?.[0];
    if (banner === undefined) throw new Error("composer bridge was not registered");

    const rendered = renderSlot(banner, {}, {
      composer: {
        scope: { kind: "thread", threadId: "th_destination" },
      },
    });
    expect(rendered.queryByRole("region")).toBeNull();
    expect(
      rendered.container.querySelector("[data-bb-thread-reference-bridge]"),
    ).not.toBeNull();
    rendered.lifecycle.unmount();
  });

  it("accepts a drop directly on the composer editor", async () => {
    const app = await loadPluginApp(() => import("../src/app"));
    const banner = app.composerCustomizations[0]?.banners?.[0];
    if (banner === undefined) throw new Error("composer bridge was not registered");

    const rendered = renderSlot(banner, {}, {
      composer: {
        scope: { kind: "thread", threadId: "th_destination" },
      },
    });
    const surface = document.createElement("div");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.append(surface);
    surface.append(rendered.container, editor);

    const mounted = await mountPluginContentScripts(app, {
      pluginId: "thread-reference",
    });
    const transfer = fakeDataTransfer();
    transfer.setData(
      THREAD_REFERENCE_MIME,
      serializeThreadReferencePayload({
        threadId: "th_source",
        label: "Source thread",
      }),
    );
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: transfer });
    editor.dispatchEvent(drop);

    expect(rendered.inspection.composer.mentions).toEqual([
      {
        provider: "thread-reference",
        id: "th_source",
        label: "Source thread",
      },
    ]);
    expect(drop.defaultPrevented).toBe(true);
    rendered.lifecycle.unmount();
    await mounted.lifecycle.dispose();
  });

  it("turns persisted thread mentions into links to the source thread", async () => {
    const sourceRow = document.createElement("a");
    sourceRow.dataset.sidebarThreadId = "th_source";
    sourceRow.href = "/threads/th_source";
    sourceRow.textContent = "Source thread";
    const mention = document.createElement("span");
    mention.setAttribute(
      "data-prompt-mention-resource",
      JSON.stringify({
        kind: "plugin",
        pluginId: "thread-reference",
        itemId: "thread-reference:th_source",
        label: "Source thread",
      }),
    );
    mention.textContent = "Source thread";
    document.body.append(sourceRow, mention);
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    const app = await loadPluginApp(() => import("../src/app"));
    const mounted = await mountPluginContentScripts(app, {
      pluginId: "thread-reference",
    });

    expect(mention.getAttribute("data-bb-thread-reference-link")).toBe("true");
    expect(mention.getAttribute("role")).toBe("link");
    expect(mention.getAttribute("tabindex")).toBe("0");
    expect(mention.getAttribute("aria-label")).toBe(
      "Open referenced thread: Source thread",
    );

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    mention.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(anchorClick).toHaveBeenCalledTimes(1);

    await mounted.lifecycle.dispose();
    expect(mention.getAttribute("data-bb-thread-reference-link")).toBeNull();
    expect(mention.getAttribute("role")).toBeNull();
    anchorClick.mockRestore();
  });
});
