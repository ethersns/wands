import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

import "@testing-library/jest-dom/vitest";

// Vitest globals are off, so Testing Library's automatic cleanup does not run.
afterEach(() => {
  cleanup();
});
