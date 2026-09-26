import { vi } from "vitest";

type MediaListener = (event: { matches: boolean }) => void;

export function setViewport(width: number, height = 800) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

function createMatchMedia(width: number) {
  const listeners = new Set<MediaListener>();

  return (query: string): MediaQueryList => {
    const maxMatch = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
    const minMatch = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(query);

    let matches = false;
    if (maxMatch) matches = width <= parseFloat(maxMatch[1]);
    if (minMatch) matches = width >= parseFloat(minMatch[1]);

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: MediaListener) =>
        listeners.add(listener),
      removeEventListener: (_: string, listener: MediaListener) =>
        listeners.delete(listener),
      addListener: (listener: MediaListener) => listeners.add(listener),
      removeListener: (listener: MediaListener) => listeners.delete(listener),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

export function mockViewport(width: number, height = 800) {
  setViewport(width, height);
  window.matchMedia = createMatchMedia(width);
}

export function stubScrollAndPointer() {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  }
}
