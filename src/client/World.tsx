import { useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot, Point, BuildingView } from "../shared/types";
import { distance, inZone, validPoint } from "../shared/map";
import { CONFIG } from "../shared/config";
import { islandViewport, mapPoint } from "./mapViewport";
const colors = ["#8ff0c1", "#ff9b83"];
export function World({
  state,
  onPlace,
  onInvalid,
  onMove,
}: {
  state: Snapshot;
  onPlace: (p: Point) => void;
  onMove?: (p: Point) => void;
  onInvalid: (message: string) => void;
}) {
  const viewport = useMemo(
    () => islandViewport(state.boundary),
    [state.boundary],
  );
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const pointers = useRef(new Set<number>());
  const tap = useRef<
    | { id: number; x: number; y: number; at: number; canceled: boolean }
    | undefined
  >(undefined);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      pointers.current.add(e.pointerId);
      if (pointers.current.size > 1 && tap.current) tap.current.canceled = true;
    };
    const move = (e: PointerEvent) => {
      const t = tap.current;
      if (
        t?.id === e.pointerId &&
        Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8
      )
        t.canceled = true;
    };
    const up = (e: PointerEvent) => {
      pointers.current.delete(e.pointerId);
    };
    const cancel = (e: PointerEvent) => {
      if (tap.current) tap.current.canceled = true;
      up(e);
    };
    const blur = () => {
      tap.current = undefined;
      pointers.current.clear();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", blur);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const [selected, setSelected] = useState<Point>();
  const selectedRef = useRef<Point | undefined>(undefined);
  selectedRef.current = selected;
  const placed = state.roster.find((p) => p.id === state.selfId)?.placed;
  useEffect(() => {
    setSelected(undefined);
  }, [state.mapVersion, state.phase, placed]);
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(state),
    previous = useRef(state),
    received = useRef(performance.now());
  useEffect(() => {
    previous.current = latest.current;
    latest.current = state;
    received.current = performance.now();
  }, [state]);
  useEffect(() => {
    const el = canvas.current!,
      ctx = el.getContext("2d")!;
    const fog = document.createElement("canvas"),
      fc = fog.getContext("2d")!;
    let frame: number;
    const draw = () => {
      const s = latest.current,
        rect = el.getBoundingClientRect(),
        dpr =
          (window.devicePixelRatio || 1) * (window.visualViewport?.scale || 1);
      if (rect.width <= 0) {
        frame = requestAnimationFrame(draw);
        return;
      }
      const pixels = Math.max(1, Math.round(rect.width * dpr));
      if (
        el.width !== pixels ||
        el.height !== pixels ||
        fog.width !== pixels ||
        fog.height !== pixels
      ) {
        el.width = pixels;
        el.height = pixels;
        fog.width = pixels;
        fog.height = pixels;
      }
      const view = viewportRef.current;
      const scale = pixels / view.size;
      ctx.setTransform(
        scale,
        0,
        0,
        scale,
        -view.left * scale,
        -view.top * scale,
      );
      ctx.clearRect(0, 0, 200, 200);
      ctx.fillStyle = "#0b202a";
      ctx.fillRect(0, 0, 200, 200);
      // Quiet water lines and a radial, continuous coastline.
      ctx.strokeStyle = "#16323b";
      ctx.lineWidth = 0.2;
      for (let i = 10; i < 200; i += 10) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(200, i);
        ctx.stroke();
      }
      const island = () => {
        ctx.beginPath();
        s.boundary.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
      };
      island();
      ctx.fillStyle = "#1a3437";
      ctx.fill();
      ctx.strokeStyle = "#557b70";
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.save();
      island();
      ctx.clip();
      ctx.strokeStyle = "#284247";
      ctx.lineWidth = 0.15;
      for (let i = 0; i < 200; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 200);
        ctx.moveTo(0, i);
        ctx.lineTo(200, i);
        ctx.stroke();
      }
      if (s.phase === "placement") {
        const zone = s.zones.find((z) => z.id === s.selfId)?.zone;
        if (zone !== undefined) {
          ctx.fillStyle = "#8ff0c125";
          if (s.mode === "1v1") ctx.fillRect(zone === 0 ? 0 : 100, 0, 100, 200);
          else
            ctx.fillRect(
              (zone % 2) * 100,
              Math.floor(zone / 2) * 100,
              100,
              100,
            );
        }
        ctx.strokeStyle = "#8ff0c17a";
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(100, 0);
        ctx.lineTo(100, 200);
        if (s.mode === "2v2") {
          ctx.moveTo(0, 100);
          ctx.lineTo(200, 100);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const alpha = Math.min(
        1,
        (performance.now() - received.current) / CONFIG.tickMs,
      );
      const interpolated = s.players.map((p) => {
        const old =
          previous.current.mapVersion === s.mapVersion
            ? previous.current.players.find((t) => t.id === p.id)
            : undefined;
        // A respawn is a discontinuity, never interpolate across the island.
        if (!old || Math.hypot(old.x - p.x, old.y - p.y) > 8) return p;
        return {
          ...p,
          x: old.x + (p.x - old.x) * alpha,
          y: old.y + (p.y - old.y) * alpha,
        };
      });
      const self = interpolated.find((p) => p.id === s.selfId);
      if (self && s.phase === "playing") {
        ctx.strokeStyle = "#8ff0c12b";
        ctx.lineWidth = 0.25;
        ctx.setLineDash([1, 1]);
        ctx.beginPath();
        ctx.arc(self.x, self.y, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      function building(b: BuildingView) {
        const c = b.teamId === null ? "#c4c7a9" : colors[b.teamId];
        ctx.save();
        ctx.translate(b.x, b.y);
        if (s.targetId === b.id) {
          ctx.strokeStyle = "#fff5c5";
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = c;
        ctx.strokeStyle = c;
        ctx.lineWidth = 0.7;
        if (b.kind === "core") {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const x = Math.cos(a) * 3,
              y = Math.sin(a) * 3;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = c + "35";
          ctx.fill();
          ctx.fillStyle = c;
          ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
        } else if (b.kind === "plant") {
          ctx.beginPath();
          ctx.moveTo(-1, -2.3);
          ctx.lineTo(1.4, -2.3);
          ctx.lineTo(0, 0);
          ctx.lineTo(1.7, 0);
          ctx.lineTo(-1.4, 2.8);
          ctx.lineTo(-0.2, 0.7);
          ctx.lineTo(-1.8, 0.7);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.strokeRect(-2, -2, 4, 4);
          ctx.fillRect(-1, -1, 2, 2);
        }
        ctx.font = "bold 2.7px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f2f5e9";
        if (b.power !== undefined) ctx.fillText(String(b.power), 0, -4);
        ctx.font = "2px system-ui";
        ctx.fillStyle = c;
        ctx.fillText(
          b.kind === "core"
            ? b.ownerId === s.selfId
              ? "YOUR CORE"
              : "CORE"
            : b.kind === "plant"
              ? "PLANT"
              : "FORT",
          0,
          5.7,
        );
        ctx.restore();
      }
      s.buildings.forEach(building);
      const preview = selectedRef.current;
      if (s.phase === "placement" && preview) {
        ctx.save();
        ctx.translate(preview.x, preview.y);
        ctx.strokeStyle = "#8ff0c1";
        ctx.lineWidth = 0.65;
        ctx.setLineDash([1, 1]);
        ctx.beginPath();
        ctx.arc(0, 0, 3.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(5, 0);
        ctx.moveTo(0, -5);
        ctx.lineTo(0, 5);
        ctx.stroke();
        ctx.font = "bold 2.3px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "#8ff0c1";
        ctx.fillText("CLICK AGAIN TO CONFIRM", 0, 8);
        ctx.restore();
      }
      for (const p of interpolated) {
        const c = colors[p.teamId];
        ctx.fillStyle = c;
        ctx.strokeStyle = p.id === s.selfId ? "#fff9dd" : c;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (p.sprintTicks) {
          ctx.strokeStyle = c + "90";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (s.targetId === p.id) {
          ctx.strokeStyle = "#fff5c5";
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.font = "bold 2.6px system-ui";
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff9e7";
        ctx.fillText(String(p.power), p.x, p.y - 3);
        ctx.font = "2px system-ui";
        ctx.fillText(p.id === s.selfId ? "YOU" : p.name, p.x, p.y + 4.5);
      }
      if (s.phase !== "placement") {
        fc.setTransform(
          scale,
          0,
          0,
          scale,
          -view.left * scale,
          -view.top * scale,
        );
        fc.globalCompositeOperation = "source-over";
        fc.clearRect(0, 0, 200, 200);
        fc.fillStyle = "#08171ef5";
        fc.fillRect(0, 0, 200, 200);
        fc.globalCompositeOperation = "destination-out";
        const vision = s.vision.map((v) => {
          const p = s.players.find(
            (p) => Math.abs(p.x - v.x) < 0.001 && Math.abs(p.y - v.y) < 0.001,
          );
          const smooth = p
            ? interpolated.find((t) => t.id === p.id)
            : undefined;
          return smooth ? { ...v, x: smooth.x, y: smooth.y } : v;
        });
        for (const v of vision) {
          const g = fc.createRadialGradient(
            v.x,
            v.y,
            v.radius * 0.92,
            v.x,
            v.y,
            v.radius,
          );
          g.addColorStop(0, "#000");
          g.addColorStop(1, "#0000");
          fc.fillStyle = g;
          fc.beginPath();
          fc.arc(v.x, v.y, v.radius, 0, Math.PI * 2);
          fc.fill();
        }
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(fog, 0, 0);
        ctx.restore();
      }
      ctx.restore();
      // Tutorial annotations reveal suggested positions only, never hidden Power
      // or entities. Draw after fog so they remain useful while exploring.
      for (const [i, marker] of (s.tutorial?.markers ?? []).entries()) {
        ctx.strokeStyle = "#ffe49a";
        ctx.lineWidth = 0.45;
        ctx.setLineDash([1, 0.8]);
        ctx.beginPath();
        ctx.arc(marker.x, marker.y, 4.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const fontSize = Math.max(2.5, (10 * dpr) / scale);
        ctx.font = `bold ${fontSize}px system-ui`;
        ctx.textAlign = "center";
        const y =
          marker.y + (marker.label === "Enemy Core" ? 10 : i % 2 ? 8 : -7);
        const width = ctx.measureText(marker.label).width + 3;
        ctx.fillStyle = "#08171ef2";
        ctx.fillRect(
          marker.x - width / 2,
          y - fontSize - 0.5,
          width,
          fontSize + 1.5,
        );
        ctx.fillStyle = "#ffe49a";
        ctx.fillText(marker.label, marker.x, y);
      }
      // Map compass is presentation only, not an extra control.
      ctx.fillStyle = "#83a0a6";
      ctx.font = "2.5px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(
        "N ↑",
        view.left + view.size * 0.03,
        view.top + view.size * 0.045,
      );
      ctx.textAlign = "right";
      ctx.fillText(
        "200 × 200",
        view.left + view.size * 0.97,
        view.top + view.size * 0.965,
      );
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <canvas
      data-map-left={viewport.left}
      data-map-top={viewport.top}
      data-map-size={viewport.size}
      data-zone={state.zones.find((z) => z.id === state.selfId)?.zone}
      data-selected={selected ? `${selected.x},${selected.y}` : undefined}
      ref={canvas}
      className={"world " + (state.phase === "placement" ? "placing" : "")}
      aria-label="Island map. Tap to move during play. Select a Core position, then tap the selected spot again to confirm."
      onPointerDown={(e) => {
        if (e.button !== 0 || pointers.current.size > 1) {
          if (tap.current) tap.current.canceled = true;
          return;
        }
        tap.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          at: performance.now(),
          canceled: false,
        };
      }}
      onPointerUp={(e) => {
        const t = tap.current;
        tap.current = undefined;
        if (
          !t ||
          t.id !== e.pointerId ||
          t.canceled ||
          performance.now() - t.at > 600 ||
          Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8
        )
          return;
        const self = state.roster.find((p) => p.id === state.selfId);
        if (!self?.alive) return;
        const r = e.currentTarget.getBoundingClientRect();
        const point = mapPoint({ x: e.clientX, y: e.clientY }, r, viewport);
        if (state.phase === "playing") {
          if (validPoint(point, state.boundary)) {
            onInvalid("");
            onMove?.(point);
          } else onInvalid("Tap a destination inside the coast.");
          return;
        }
        if (state.phase !== "placement" || self.placed) return;
        const zone = state.zones.find((z) => z.id === state.selfId)?.zone;
        if (selected && distance(selected, point) <= 3) {
          onPlace(selected);
          return;
        }
        if (
          zone === undefined ||
          !validPoint(point, state.boundary) ||
          !inZone(point, zone, state.mode) ||
          state.buildings.some(
            (b) => distance(b, point) < CONFIG.corePlacementSpacing,
          )
        ) {
          onInvalid(
            "Select a spot inside your zone, away from buildings and the coast.",
          );
          return;
        }
        onInvalid("");
        setSelected(point);
      }}
    />
  );
}
