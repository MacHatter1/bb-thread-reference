import { useEffect, useRef } from "react";
import {
  definePluginApp,
  useComposer,
} from "@get-bb/plugin-sdk/app";
import {
  THREAD_REFERENCE_MIME,
  THREAD_REFERENCE_PROVIDER,
  isValidThreadReferenceId,
  normalizeThreadReferenceLabel,
  parseThreadReferenceMentionResource,
  parseThreadReferencePayload,
  serializeThreadReferencePayload,
  type ThreadReferencePayload,
} from "./shared.js";

const EDITOR_SELECTOR = '[contenteditable="true"], textarea';
const SOURCE_MARKER = "data-bb-thread-reference-source";
const HANDLE_MARKER = "data-bb-thread-reference-handle";
const LINK_MARKER = "data-bb-thread-reference-link";
const MENTION_SELECTOR = "[data-prompt-mention-resource]";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SOURCE_CURSOR_CLASS = "cursor-grab";
const ACTIVE_CURSOR_CLASS = "cursor-grabbing";
const HANDLE_CLASS_NAMES = [
  "pointer-events-auto",
  "relative",
  "z-20",
  "inline-flex",
  "size-7",
  "shrink-0",
  "select-none",
  "items-center",
  "justify-center",
  "rounded-md",
  "p-0",
  "text-subtle-foreground",
  "opacity-90",
  "transition-colors",
  "hover:bg-state-hover",
  "hover:text-muted-foreground",
  "hover:opacity-100",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-sidebar-ring",
  "active:bg-state-active",
  "cursor-grab",
] as const;

type DropReceiver = {
  root: HTMLElement;
  receive(payload: ThreadReferencePayload): void;
};

type OriginalMentionAttributes = {
  role: string | null;
  tabIndex: string | null;
  ariaLabel: string | null;
  title: string | null;
  marker: string | null;
  hadCursorClass: boolean;
};

/**
 * Content scripts and React composer bridges share this small in-memory bridge.
 * It is scoped to one loaded app bundle, and every receiver unregisters when its
 * composer unmounts.
 */
const dropReceivers = new Set<DropReceiver>();

function isElement(value: EventTarget | null): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

function editorFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!isElement(target)) return null;
  return target.closest<HTMLElement>(EDITOR_SELECTOR);
}

function receiverOwnsEditor(root: HTMLElement, editor: HTMLElement): boolean {
  // The nearest ancestor containing exactly one editable is the composer
  // surface in BB's current DOM. The bounded walk avoids treating the whole
  // app shell as one composer when split panes are visible.
  let ancestor = root.parentElement;
  for (let depth = 0; ancestor !== null && depth < 12; depth += 1) {
    if (ancestor.contains(editor) && ancestor.contains(root)) {
      const editors = ancestor.querySelectorAll<HTMLElement>(EDITOR_SELECTOR);
      if (editors.length === 1 && editors[0] === editor) return true;
    }
    ancestor = ancestor.parentElement;
  }

  // A single visible composer is common on compact screens. Allow it as a
  // fallback if the host adds an extra wrapper around its input.
  return dropReceivers.size === 1;
}

function notifyDrop(
  payload: ThreadReferencePayload,
  target: EventTarget | null,
): boolean {
  const editor = editorFromTarget(target);
  if (editor === null) return false;

  const receivers = Array.from(dropReceivers).filter((receiver) =>
    receiverOwnsEditor(receiver.root, editor),
  );
  const receiver = receivers[0];
  if (receiver === undefined) return false;
  receiver.receive(payload);
  return true;
}

function hasThreadReferenceType(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(THREAD_REFERENCE_MIME) ?? false;
}

function navigateToThread(threadId: string): void {
  const row = Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"),
  ).find((candidate) => candidate.getAttribute("data-sidebar-thread-id") === threadId);
  const link =
    row instanceof HTMLAnchorElement
      ? row
      : row?.querySelector<HTMLAnchorElement>("a[href]");
  if (link !== undefined && link !== null) {
    link.click();
    return;
  }
  window.location.assign(`/threads/${encodeURIComponent(threadId)}`);
}

function labelForThreadRow(row: HTMLElement): string {
  const explicitLabel = row.getAttribute("aria-label") ?? row.getAttribute("title");
  if (explicitLabel !== null) return normalizeThreadReferenceLabel(explicitLabel);

  // The drag handle is injected into the native row. Exclude it so the
  // visible affordance never becomes part of the reference label.
  const clone = row.cloneNode(true) as HTMLElement;
  clone.querySelector(`[${HANDLE_MARKER}]`)?.remove();
  return normalizeThreadReferenceLabel(clone.textContent ?? "");
}

function appendGripIcon(handle: HTMLElement): void {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.setAttribute("viewBox", "0 0 12 18");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "22");
  icon.setAttribute("aria-hidden", "true");
  icon.classList.add("size-4", "shrink-0");

  for (const y of [3, 9, 15]) {
    for (const x of [3, 9]) {
      const dot = document.createElementNS(SVG_NAMESPACE, "circle");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "1.35");
      dot.setAttribute("fill", "currentColor");
      icon.append(dot);
    }
  }

  handle.append(icon);
}

function mountThreadReferenceContentScript({ signal }: { signal: AbortSignal }) {
  const originalRows = new Map<
    HTMLElement,
    {
      draggable: string | null;
      marker: string | null;
      hadCursorClass: boolean;
      handle: HTMLElement;
    }
  >();
  const originalMentions = new Map<HTMLElement, OriginalMentionAttributes>();
  let disposed = false;
  let observer: MutationObserver | null = null;

  const onDragStart = (event: Event) => {
    // Do not let BB's native row drag gesture turn this into a split-view
    // navigation. Only the injected handle is a source for this plugin.
    event.stopPropagation();
    const handle = event.currentTarget;
    if (!(handle instanceof HTMLElement)) return;
    let row: HTMLElement | null = handle.closest<HTMLElement>("[data-sidebar-thread-id]");
    let ancestor = handle.parentElement;
    for (let depth = 0; row === null && ancestor !== null && depth < 5; depth += 1) {
      row = ancestor.querySelector<HTMLElement>("[data-sidebar-thread-id]");
      ancestor = ancestor.parentElement;
    }
    if (row === null) return;
    const threadId = row.getAttribute("data-sidebar-thread-id");
    const dataTransfer = (event as unknown as globalThis.DragEvent).dataTransfer;
    if (!isValidThreadReferenceId(threadId) || dataTransfer === null) return;

    const payload: ThreadReferencePayload = {
      threadId,
      label: labelForThreadRow(row),
    };
    try {
      dataTransfer.setData(THREAD_REFERENCE_MIME, serializeThreadReferencePayload(payload));
      dataTransfer.setData(
        "text/plain",
        `Reference BB thread: ${payload.label} (${payload.threadId})`,
      );
      dataTransfer.effectAllowed = "copy";
    } catch {
      // Some browser drag implementations expose a read-only DataTransfer.
      // The native row remains usable; the custom drop behavior simply will
      // not activate for that drag.
      return;
    }
    handle.classList.add(ACTIVE_CURSOR_CLASS);
  };

  const onDragEnd = (event: Event) => {
    const handle = event.currentTarget;
    if (handle instanceof HTMLElement) handle.classList.remove(ACTIVE_CURSOR_CLASS);
  };

  const stopNativeRowGesture = (event: Event) => {
    event.stopPropagation();
    if (event.type === "click") event.preventDefault();
  };

  const decorateRows = () => {
    if (disposed) return;
    const rows = document.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]");
    for (const row of Array.from(rows)) {
      if (originalRows.has(row)) continue;
      const threadId = row.getAttribute("data-sidebar-thread-id");
      if (!isValidThreadReferenceId(threadId)) continue;

      originalRows.set(row, {
        draggable: row.getAttribute("draggable"),
        marker: row.getAttribute(SOURCE_MARKER),
        hadCursorClass: row.classList.contains(SOURCE_CURSOR_CLASS),
        handle: document.createElement("span"),
      });
      const original = originalRows.get(row);
      if (original === undefined) continue;

      const handle = original.handle;
      handle.setAttribute(HANDLE_MARKER, "true");
      handle.setAttribute("draggable", "true");
      handle.setAttribute("role", "img");
      handle.setAttribute("aria-label", "Drag to reference this thread");
      handle.setAttribute("title", "Drag to reference this thread");
      handle.classList.add(...HANDLE_CLASS_NAMES);
      appendGripIcon(handle);

      // BB marks native sidebar rows draggable for split-view navigation.
      // Disable that source while this plugin is active so only our handle
      // can start a drag, then restore the host value during cleanup.
      row.setAttribute("draggable", "false");
      row.setAttribute(SOURCE_MARKER, "true");
      handle.addEventListener("dragstart", onDragStart);
      handle.addEventListener("dragend", onDragEnd);
      handle.addEventListener("pointerdown", stopNativeRowGesture, true);
      handle.addEventListener("mousedown", stopNativeRowGesture, true);
      handle.addEventListener("click", stopNativeRowGesture, true);
      const rowContainer = row.parentElement;
      if (rowContainer === null) {
        originalRows.delete(row);
        continue;
      }
      const trailingControls = Array.from(rowContainer.children).find((child) =>
        child.querySelector(
          "[data-sidebar-thread-trailing-indicator], [data-sidebar-row-controls]",
        ) !== null,
      );
      if (trailingControls !== undefined) {
        const hoverActions = trailingControls.querySelector<HTMLElement>(
          ".bb-sidebar-hover-actions",
        );
        if (hoverActions !== null) trailingControls.insertBefore(handle, hoverActions);
        else trailingControls.append(handle);
      } else {
        rowContainer.append(handle);
      }
    }
  };

  const onReferenceMentionClick = (event: Event) => {
    const mention = event.currentTarget;
    if (!(mention instanceof HTMLElement)) return;
    const payload = parseThreadReferenceMentionResource(
      mention.getAttribute("data-prompt-mention-resource") ?? "",
    );
    if (payload === null) return;
    event.preventDefault();
    event.stopPropagation();
    navigateToThread(payload.threadId);
  };

  const onReferenceMentionKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    onReferenceMentionClick(event);
  };

  const removeMentionDecoration = (mention: HTMLElement) => {
    const original = originalMentions.get(mention);
    if (original === undefined) return;
    mention.removeEventListener("click", onReferenceMentionClick);
    mention.removeEventListener("keydown", onReferenceMentionKeyDown);
    if (original.role === null) mention.removeAttribute("role");
    else mention.setAttribute("role", original.role);
    if (original.tabIndex === null) mention.removeAttribute("tabindex");
    else mention.setAttribute("tabindex", original.tabIndex);
    if (original.ariaLabel === null) mention.removeAttribute("aria-label");
    else mention.setAttribute("aria-label", original.ariaLabel);
    if (original.title === null) mention.removeAttribute("title");
    else mention.setAttribute("title", original.title);
    if (original.marker === null) mention.removeAttribute(LINK_MARKER);
    else mention.setAttribute(LINK_MARKER, original.marker);
    if (original.hadCursorClass) mention.classList.add("cursor-pointer");
    else mention.classList.remove("cursor-pointer");
    originalMentions.delete(mention);
  };

  const decorateReferenceMentions = () => {
    if (disposed) return;
    const mentions = document.querySelectorAll<HTMLElement>(MENTION_SELECTOR);
    for (const mention of Array.from(mentions)) {
      // Composer mentions remain editable tokens. Only persisted message
      // mentions become links.
      if (mention.closest(EDITOR_SELECTOR) !== null) {
        removeMentionDecoration(mention);
        continue;
      }
      const payload = parseThreadReferenceMentionResource(
        mention.getAttribute("data-prompt-mention-resource") ?? "",
      );
      if (payload === null || originalMentions.has(mention)) continue;
      originalMentions.set(mention, {
        role: mention.getAttribute("role"),
        tabIndex: mention.getAttribute("tabindex"),
        ariaLabel: mention.getAttribute("aria-label"),
        title: mention.getAttribute("title"),
        marker: mention.getAttribute(LINK_MARKER),
        hadCursorClass: mention.classList.contains("cursor-pointer"),
      });
      mention.setAttribute(LINK_MARKER, "true");
      mention.setAttribute("role", "link");
      mention.setAttribute("tabindex", "0");
      mention.setAttribute("aria-label", `Open referenced thread: ${payload.label}`);
      mention.setAttribute("title", `Open referenced thread: ${payload.label}`);
      mention.classList.add("cursor-pointer");
      mention.addEventListener("click", onReferenceMentionClick);
      mention.addEventListener("keydown", onReferenceMentionKeyDown);
    }
  };

  const notifyDropTarget = (target: EventTarget | null): boolean => {
    const editor = editorFromTarget(target);
    if (editor === null) return false;
    return Array.from(dropReceivers).some((receiver) =>
      receiverOwnsEditor(receiver.root, editor),
    );
  };

  const onEditorDragOver = (event: Event) => {
    const dragEvent = event as unknown as globalThis.DragEvent;
    if (!hasThreadReferenceType(dragEvent.dataTransfer)) return;
    if (!notifyDropTarget(dragEvent.target)) return;
    dragEvent.preventDefault();
    if (dragEvent.dataTransfer !== null) dragEvent.dataTransfer.dropEffect = "copy";
  };

  const onEditorDrop = (event: Event) => {
    const dropEvent = event as unknown as globalThis.DragEvent;
    if (!hasThreadReferenceType(dropEvent.dataTransfer)) return;
    const editor = editorFromTarget(dropEvent.target);
    if (editor === null || dropEvent.dataTransfer === null) return;
    const payload = parseThreadReferencePayload(
      dropEvent.dataTransfer.getData(THREAD_REFERENCE_MIME),
    );
    if (payload === null || !notifyDrop(payload, editor)) return;

    dropEvent.preventDefault();
    dropEvent.stopPropagation();
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    observer = null;
    document.removeEventListener("dragover", onEditorDragOver, true);
    document.removeEventListener("drop", onEditorDrop, true);
    signal.removeEventListener("abort", cleanup);
    for (const [row, original] of originalRows) {
      const handle = original.handle;
      handle.removeEventListener("dragstart", onDragStart);
      handle.removeEventListener("dragend", onDragEnd);
      handle.removeEventListener("pointerdown", stopNativeRowGesture, true);
      handle.removeEventListener("mousedown", stopNativeRowGesture, true);
      handle.removeEventListener("click", stopNativeRowGesture, true);
      handle.classList.remove(ACTIVE_CURSOR_CLASS);
      handle.remove();
      if (original.draggable === null) row.removeAttribute("draggable");
      else row.setAttribute("draggable", original.draggable);
      if (original.marker === null) row.removeAttribute(SOURCE_MARKER);
      else row.setAttribute(SOURCE_MARKER, original.marker);
      if (original.hadCursorClass) row.classList.add(SOURCE_CURSOR_CLASS);
      else row.classList.remove(SOURCE_CURSOR_CLASS);
    }
    originalRows.clear();
    for (const mention of Array.from(originalMentions.keys())) {
      removeMentionDecoration(mention);
    }
  };

  document.addEventListener("dragover", onEditorDragOver, true);
  document.addEventListener("drop", onEditorDrop, true);
  decorateRows();
  decorateReferenceMentions();

  const root = document.body ?? document.documentElement;
  if (root !== null) {
    observer = new MutationObserver(() => {
      decorateRows();
      decorateReferenceMentions();
    });
    observer.observe(root, { childList: true, subtree: true });
  }
  signal.addEventListener("abort", cleanup, { once: true });
  return cleanup;
}

function ThreadReferenceComposerBridge() {
  const composer = useComposer();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const receiver: DropReceiver = {
      root,
      receive: (payload) => {
        composer.insertMention({
          provider: THREAD_REFERENCE_PROVIDER,
          id: payload.threadId,
          label: payload.label,
        });
      },
    };
    dropReceivers.add(receiver);
    return () => {
      dropReceivers.delete(receiver);
    };
  }, [composer]);

  return (
    <span
      ref={rootRef}
      hidden
      aria-hidden="true"
      data-bb-thread-reference-bridge="true"
    />
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "thread-reference-drag-source",
    mount: mountThreadReferenceContentScript,
  });

  app.composer.customize({
    id: "thread-reference-composer-bridge",
    banners: [
      {
        id: "thread-reference-composer-bridge",
        chrome: "bare",
        component: ThreadReferenceComposerBridge,
      },
    ],
  });
});
