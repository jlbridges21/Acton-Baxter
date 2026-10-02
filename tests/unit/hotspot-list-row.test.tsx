/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HotspotPanel } from "@/components/tours/hotspot-panel";
import { hotspotListRow } from "@/lib/tours/hotspot-markers";
import type { ViewerHotspot, ViewerScene } from "@/lib/tours/viewer-model";

afterEach(() => {
  cleanup();
});

function hotspot(partial: Partial<ViewerHotspot> & Pick<ViewerHotspot, "id">): ViewerHotspot {
  return {
    type: "link",
    yaw: 0.1,
    pitch: 0,
    label: null,
    content: null,
    targetSceneId: null,
    styleShape: "arrow",
    styleColor: "#FFFFFF",
    styleSize: 48,
    styleRotation: 0,
    stylePlacement: "billboard",
    ...partial,
  };
}

function scene(partial: Partial<ViewerScene> & Pick<ViewerScene, "id" | "name">): ViewerScene {
  return {
    width: 100,
    height: 50,
    hasCompat: false,
    hasInitialView: false,
    initialYaw: 0,
    initialPitch: 0,
    thumbUrl: null,
    hotspots: [],
    ...partial,
  };
}

const longName = "i448A1_360_View02_Firefly_Gemini";

describe("hotspot list rows", () => {
  it("names a link by its target and an info hotspot by its label", () => {
    const scenes = [scene({ id: "here", name: "Here" }), scene({ id: "there", name: longName })];
    expect(hotspotListRow(hotspot({ id: "link", targetSceneId: "there" }), scenes)).toEqual({
      primary: longName,
      muted: false,
      broken: false,
      kind: "Link",
    });
    expect(
      hotspotListRow(hotspot({ id: "note", type: "info", label: "Washer" }), scenes),
    ).toMatchObject({ primary: "Washer", muted: false, kind: "Info", broken: false });
    expect(
      hotspotListRow(hotspot({ id: "blank", type: "info", label: "  " }), scenes),
    ).toMatchObject({ primary: "Untitled", muted: true, kind: "Info" });
    expect(hotspotListRow(hotspot({ id: "open", targetSceneId: null }), scenes)).toEqual({
      primary: "No target scene",
      muted: true,
      broken: true,
      kind: "Link",
    });
    expect(hotspotListRow(hotspot({ id: "gone", targetSceneId: "deleted" }), scenes)).toEqual({
      primary: "Broken link",
      muted: false,
      broken: true,
      kind: "Link",
    });
  });

  it("follows a renamed scene and truncates the row without dropping the full name", () => {
    const link = hotspot({ id: "link", targetSceneId: "there" });
    const info = hotspot({ id: "note", type: "info", label: null });
    const unset = hotspot({ id: "open", targetSceneId: null });
    const deleted = hotspot({ id: "gone", targetSceneId: "deleted" });
    const here = scene({
      id: "here",
      name: "Here",
      hotspots: [link, info, unset, deleted],
    });
    const onSelect = vi.fn();
    const { rerender } = render(
      <div className="w-80 overflow-x-hidden">
        <HotspotPanel
          scene={here}
          scenes={[here, scene({ id: "there", name: "Kitchen" })]}
          selected={link}
          placing={false}
          busy={false}
          onStartPlace={() => undefined}
          onCancelPlace={() => undefined}
          onSelect={onSelect}
          onDraft={() => undefined}
          onCommit={() => undefined}
          onDelete={() => undefined}
        />
      </div>,
    );

    const named = screen.getByRole("button", { name: "Kitchen, Link" });
    expect(named.getAttribute("title")).toBe("Kitchen");
    expect(named.className).toContain("overflow-hidden");
    expect(named.className).toContain("border-[var(--acton-navy)]");
    expect(named.querySelector("span")?.className).toContain("truncate");
    expect(screen.getByRole("button", { name: "Untitled, Info" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No target scene, Broken link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Broken link" })).toBeTruthy();

    fireEvent.click(named);
    expect(onSelect).toHaveBeenCalledWith("link");

    const renamed = scene({ id: "there", name: longName });
    rerender(
      <div className="w-80 overflow-x-hidden">
        <HotspotPanel
          scene={here}
          scenes={[here, renamed]}
          selected={null}
          placing={false}
          busy={false}
          onStartPlace={() => undefined}
          onCancelPlace={() => undefined}
          onSelect={onSelect}
          onDraft={() => undefined}
          onCommit={() => undefined}
          onDelete={() => undefined}
        />
      </div>,
    );
    const updated = screen.getByRole("button", { name: `${longName}, Link` });
    expect(updated.getAttribute("title")).toBe(longName);
    expect(updated.className).not.toContain("border-[var(--acton-navy)]");
    expect(updated.textContent).toContain(longName);
    expect(updated.textContent).toContain("Link");
    const editor = readFileSync(
      path.join(process.cwd(), "src/components/tours/tour-editor.tsx"),
      "utf8",
    );
    expect(editor).toContain("scenes={displayScenes}");
    expect(editor).toContain("name: names[scene.id] ?? scene.name");
  });
});
