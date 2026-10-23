import { describe, expect, it } from "vitest";
import { DEPTH_RANK, depthZ, sortByDepth } from "@/lib/office/depth";

describe("office scene depth", () => {
  it("wall art is always behind characters; UI is always on top", () => {
    for (const y of [0, 40, 300, 1100]) {
      expect(depthZ("wall")).toBeLessThan(depthZ("world", y, DEPTH_RANK.character));
      expect(depthZ("background")).toBeLessThan(depthZ("world", y, DEPTH_RANK.decor));
      expect(depthZ("ui")).toBeGreaterThan(depthZ("world", y, DEPTH_RANK.character));
    }
    expect(depthZ("background")).toBeLessThan(depthZ("wall"));
  });

  it("floor objects and characters sort by their baseline", () => {
    const desk = { y: 160 };
    // In front of the desk (feet lower on screen) → drawn over it.
    expect(depthZ("world", desk.y + 4, DEPTH_RANK.character)).toBeGreaterThan(
      depthZ("world", desk.y, DEPTH_RANK.desk),
    );
    // Behind the desk → the desk partially hides the character.
    expect(depthZ("world", desk.y - 4, DEPTH_RANK.character)).toBeLessThan(
      depthZ("world", desk.y, DEPTH_RANK.desk),
    );
    // Same baseline: character in front of desk, desk in front of decor.
    expect(depthZ("world", 200, DEPTH_RANK.character)).toBeGreaterThan(
      depthZ("world", 200, DEPTH_RANK.desk),
    );
    expect(depthZ("world", 200, DEPTH_RANK.desk)).toBeGreaterThan(
      depthZ("world", 200, DEPTH_RANK.decor),
    );
    // Sub-pixel moves never jump past a whole pixel's worth of objects.
    expect(depthZ("world", 200.4, DEPTH_RANK.character)).toBeLessThan(
      depthZ("world", 201, DEPTH_RANK.decor),
    );
  });

  it("sorting is stable and deterministic", () => {
    const entities = [
      { id: "plant", band: "world" as const, sortY: 120, rank: DEPTH_RANK.decor },
      { id: "sam", band: "world" as const, sortY: 140, rank: DEPTH_RANK.character },
      { id: "whiteboard", band: "wall" as const, sortY: 40, rank: 0 },
      { id: "cabinet-b", band: "world" as const, sortY: 120, rank: DEPTH_RANK.decor },
      { id: "cabinet-a", band: "world" as const, sortY: 120, rank: DEPTH_RANK.decor },
      { id: "label", band: "ui" as const, sortY: 0, rank: 0 },
      { id: "rug", band: "background" as const, sortY: 300, rank: 0 },
    ];
    const order = sortByDepth(entities).map((e) => e.id);
    expect(order).toEqual(["rug", "whiteboard", "cabinet-a", "cabinet-b", "plant", "sam", "label"]);
    expect(sortByDepth([...entities].reverse()).map((e) => e.id)).toEqual(order);
  });
});
