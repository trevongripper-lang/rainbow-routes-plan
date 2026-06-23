/// <reference types="@testing-library/jest-dom" />
import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  type Matchers<T> = TestingLibraryMatchers<unknown, T>;
  interface Assertion<T> extends Matchers<T> {
    _brand?: never;
  }
  interface AsymmetricMatchersContaining extends Matchers<unknown> {
    _brand?: never;
  }
}
