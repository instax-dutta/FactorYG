// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameHeader } from "../../src/ui/components/GameHeader";
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "../../src/content/product";

describe("GameHeader", () => {
  it("keeps the public identity and preserves the canvas input boundary", () => {
    render(<GameHeader />);

    expect(PRODUCT_NAME).toBe("Factor-I");
    expect(PRODUCT_SHORT_NAME).toBe("factori");

    const header = screen.getByRole("banner");
    const heading = screen.getByRole("heading", { name: "Factor-I" });
    const shortLabel = screen.getByText("factori", { exact: true });

    expect(header).toBeVisible();
    expect(heading).toBeVisible();
    expect(shortLabel).toBeVisible();
    expect(shortLabel).toHaveTextContent("factori");
    expect(getComputedStyle(shortLabel).textTransform).toBe("none");
    expect(getComputedStyle(header).pointerEvents).toBe("none");
  });
});
