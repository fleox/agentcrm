// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Popover, usePopover } from "./Popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A popover holding a button that opens a nested popover (like a select
// picker inside the bulk "Update field" panel).
function Nested() {
  const outer = usePopover();
  const inner = usePopover();
  const [picked, setPicked] = useState("");
  return (
    <div>
      <button ref={outer.anchorRef} data-testid="outer-anchor" onClick={outer.toggle} />
      <span data-testid="picked">{picked}</span>
      <button data-testid="elsewhere" />
      <Popover open={outer.open} onClose={outer.close} anchor={outer.anchor}>
        <div data-testid="outer-panel">
          <button ref={inner.anchorRef} data-testid="inner-anchor" onClick={inner.toggle} />
          <Popover open={inner.open} onClose={inner.close} anchor={inner.anchor}>
            <button
              data-testid="option"
              onClick={() => {
                setPicked("high");
                inner.close();
              }}
            />
          </Popover>
        </div>
      </Popover>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const down = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
const click = (el: Element) => act(() => (el as HTMLElement).click());

describe("Popover", () => {
  it("keeps the parent open when clicking inside a nested popover, closes it outside", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Nested />));
    click(q("outer-anchor")!);
    click(q("inner-anchor")!);
    expect(q("option")).toBeTruthy();
    // The nested panel is portaled outside the parent's panel.
    expect(q("outer-panel")!.contains(q("option"))).toBe(false);
    down(q("option")!);
    click(q("option")!);
    expect(q("picked")!.textContent).toBe("high");
    expect(q("outer-panel")).toBeTruthy();
    expect(q("option")).toBeNull();
    down(q("elsewhere")!);
    expect(q("outer-panel")).toBeNull();
  });

  it("Escape closes the innermost popover first", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(<Nested />));
    click(q("outer-anchor")!);
    click(q("inner-anchor")!);
    const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    esc();
    expect(q("option")).toBeNull();
    expect(q("outer-panel")).toBeTruthy();
    esc();
    expect(q("outer-panel")).toBeNull();
  });
});
