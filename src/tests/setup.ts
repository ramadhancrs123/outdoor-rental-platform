import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { mockViewport, stubScrollAndPointer } from "./viewport";

beforeEach(() => {
  mockViewport(1280, 800);
  window.localStorage.clear();
  stubScrollAndPointer();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
