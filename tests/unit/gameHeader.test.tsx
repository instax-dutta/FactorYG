import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GameHeader } from "../../src/ui/components/GameHeader";
import { PRODUCT_NAME, PRODUCT_SHORT_NAME } from "../../src/content/product";

describe("GameHeader", () => {
  it("shows the public Factor-I name and short label", () => {
    render(<GameHeader />);

    expect(screen.getByRole("heading", { name: PRODUCT_NAME })).toBeVisible();
    expect(screen.getByText(PRODUCT_SHORT_NAME)).toBeVisible();
  });
});
