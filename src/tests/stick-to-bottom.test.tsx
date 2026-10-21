import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "@/components/layout/AppShell";
import { useStickToBottom, type StickToBottom } from "@/hooks/use-stick-to-bottom";
import { meFixture, mockApi, renderAt } from "./api-mock";

/**
 * jsdom has no layout, so scroll metrics are emulated: the test sets heights, the "browser" clamps
 * scrollTop, and a fake ResizeObserver lets the test decide when the layout change is delivered.
 */
interface Metrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}
const metrics = new WeakMap<Element, Metrics>();
const m = (el: Element): Metrics => {
  let v = metrics.get(el);
  if (!v) metrics.set(el, (v = { scrollHeight: 0, clientHeight: 0, scrollTop: 0 }));
  return v;
};

class FakeResizeObserver {
  static all = new Set<FakeResizeObserver>();
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.all.add(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    FakeResizeObserver.all.delete(this);
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let api: StickToBottom;
function Harness({ resetKey }: { resetKey?: string }) {
  api = useStickToBottom({ resetKey });
  return (
    <div ref={api.scrollerRef} data-testid="scroller">
      <div ref={api.contentRef} data-testid="content" />
    </div>
  );
}

const scroller = () => screen.getByTestId("scroller");
const content = () => screen.getByTestId("content");

/** Content or viewport changed size; the browser clamps scrollTop, then observers are notified. */
function relayout({ contentHeight, viewport }: { contentHeight?: number; viewport?: number }) {
  const s = m(scroller());
  if (contentHeight !== undefined) {
    m(content()).scrollHeight = contentHeight;
    s.scrollHeight = contentHeight;
  }
  if (viewport !== undefined) s.clientHeight = viewport;
  s.scrollTop = Math.min(s.scrollTop, Math.max(0, s.scrollHeight - s.clientHeight));
  act(() => FakeResizeObserver.all.forEach((o) => o.fire()));
}

/** The user (or the browser's clamping) moves the scroll position; a scroll event follows. */
function scrollTo(top: number) {
  m(scroller()).scrollTop = top;
  act(() => {
    fireEvent.scroll(scroller());
  });
}

const top = () => m(scroller()).scrollTop;
const bottom = () => m(scroller()).scrollHeight - m(scroller()).clientHeight;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, "scrollHeight", { configurable: true, get(this: Element) { return m(this).scrollHeight; } });
  Object.defineProperty(proto, "clientHeight", { configurable: true, get(this: Element) { return m(this).clientHeight; } });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get(this: Element) { return m(this).scrollHeight; } });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return m(this).scrollTop;
    },
    set(this: Element, value: number) {
      const v = m(this);
      v.scrollTop = Math.max(0, Math.min(value, v.scrollHeight - v.clientHeight));
    },
  });
  proto.scrollTo = vi.fn(function (this: Element, options: ScrollToOptions) {
    m(this).scrollTop = options.top ?? 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeResizeObserver.all.clear();
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  for (const key of ["scrollHeight", "clientHeight", "offsetHeight", "scrollTop", "scrollTo"]) delete proto[key];
});

function mount(initial = { contentHeight: 1000, viewport: 400 }) {
  const view = render(<Harness resetKey="a" />);
  relayout(initial);
  return view;
}

describe("chat scrolling (useStickToBottom)", () => {
  it("starts at the newest content and follows it as it grows", () => {
    mount();
    expect(top()).toBe(600);
    relayout({ contentHeight: 1200 });
    expect(top()).toBe(800);
    expect(api.atBottom).toBe(true);
  });

  it("follows when the viewport shrinks (on-screen keyboard, growing composer)", () => {
    mount();
    relayout({ viewport: 250 });
    expect(top()).toBe(750);
    expect(api.atBottom).toBe(true);
  });

  it("stops following when the user scrolls up, and flags content that arrives meanwhile", () => {
    mount({ contentHeight: 1200, viewport: 400 });
    scrollTo(500);
    expect(api.atBottom).toBe(false);
    expect(api.hasNewContent).toBe(false);

    relayout({ contentHeight: 1400 });
    expect(top()).toBe(500); // the reader is not dragged away
    expect(api.hasNewContent).toBe(true);
  });

  it("respects even a small scroll up while content is streaming in", () => {
    mount();
    scrollTo(top() - 10); // far less than the old 80px "near the bottom" zone
    expect(api.atBottom).toBe(false);
    relayout({ contentHeight: 1100 });
    expect(top()).toBe(590);
  });

  it("resumes following once the user scrolls back to the bottom", () => {
    mount({ contentHeight: 1400, viewport: 400 });
    scrollTo(300);
    relayout({ contentHeight: 1500 });
    expect(api.hasNewContent).toBe(true);

    scrollTo(1090); // within a few pixels of the bottom (1100), moving down
    expect(api.atBottom).toBe(true);
    expect(api.hasNewContent).toBe(false);
    relayout({ contentHeight: 1600 });
    expect(top()).toBe(1200);
  });

  it("does not mistake the browser clamping scrollTop (content shrank) for the user scrolling up", () => {
    mount({ contentHeight: 1500, viewport: 400 });
    expect(top()).toBe(1100);
    m(content()).scrollHeight = 1200;
    m(scroller()).scrollHeight = 1200;
    scrollTo(800); // clamped by the browser: upward movement, but still at the bottom
    expect(api.atBottom).toBe(true);
  });

  it("scrollToBottom() jumps back and follows again", () => {
    mount({ contentHeight: 2000, viewport: 400 });
    scrollTo(100);
    expect(api.atBottom).toBe(false);
    act(() => api.scrollToBottom());
    expect(top()).toBe(bottom());
    expect(api.atBottom).toBe(true);
    expect(api.hasNewContent).toBe(false);
  });

  it("glides for short hops but jumps instantly across long distances", () => {
    mount({ contentHeight: 2000, viewport: 400 });
    const scrollToMock = HTMLElement.prototype.scrollTo as unknown as ReturnType<typeof vi.fn>;

    scrollTo(1500); // 100px from the bottom (1600)
    act(() => api.scrollToBottom("smooth"));
    expect(scrollToMock).toHaveBeenCalledWith({ top: 2000, behavior: "smooth" });

    scrollToMock.mockClear();
    scrollTo(0); // 1600px away: gliding would take too long
    act(() => api.scrollToBottom("smooth"));
    expect(scrollToMock).not.toHaveBeenCalled();
    expect(top()).toBe(bottom());
  });

  it("re-attaches to the bottom when the reset key changes (another conversation opened)", () => {
    const view = mount({ contentHeight: 2000, viewport: 400 });
    scrollTo(0);
    expect(api.atBottom).toBe(false);
    view.rerender(<Harness resetKey="b" />);
    expect(top()).toBe(bottom());
    expect(api.atBottom).toBe(true);
  });
});

describe("full-height page shell", () => {
  it("is sized by the window, not by its content (the chat must scroll inside its panel)", () => {
    mockApi({ "GET /api/v1/me": () => meFixture() });
    renderAt("/x", [
      {
        path: "/x",
        element: (
          <AppShell title="اختبار" fullHeight>
            <p>محتوى</p>
          </AppShell>
        ),
      },
    ]);
    const root = screen.getByRole("heading", { level: 1, name: "اختبار" }).closest("header")!.parentElement!;
    // `flex-1` would set flex-basis: 0% and override the height, letting the page grow with the conversation.
    expect(root).toHaveClass("h-dvh", "flex-none", "overflow-hidden");
    expect(root).not.toHaveClass("flex-1");
  });

  it("regular pages still fill the window and grow with their content", () => {
    mockApi({ "GET /api/v1/me": () => meFixture() });
    renderAt("/x", [{ path: "/x", element: <AppShell title="عادية"><p>محتوى</p></AppShell> }]);
    const root = screen.getByRole("heading", { level: 1, name: "عادية" }).closest("header")!.parentElement!;
    expect(root).toHaveClass("min-h-dvh", "flex-1");
    expect(root).not.toHaveClass("overflow-hidden");
  });
});
