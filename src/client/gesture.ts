import { CONFIG } from "../shared/config";
export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
  now(): number;
}
const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};
// One locked target and exactly one resolved command per gesture.
export class InteractionGesture {
  private pressed = false;
  private pending = false;
  private held = false;
  private second = false;
  private holdTimer: unknown;
  private singleTimer: unknown;
  constructor(
    private begin: () => void,
    private resolve: (kind: "half" | "max" | "deposit") => void,
    private timer = realTimer,
  ) {}
  down() {
    if (this.pressed) return;
    this.pressed = true;
    this.held = false;
    this.second = this.pending;
    if (this.pending) {
      this.timer.clear(this.singleTimer);
      this.pending = false;
    } else this.begin();
    this.holdTimer = this.timer.set(() => {
      this.held = true;
      this.second = false;
      this.pending = false;
      this.resolve("deposit");
    }, CONFIG.holdMs);
  }
  up() {
    if (!this.pressed) return;
    this.pressed = false;
    this.timer.clear(this.holdTimer);
    if (this.held) return;
    if (this.second) {
      this.second = false;
      this.resolve("max");
      return;
    }
    this.pending = true;
    this.singleTimer = this.timer.set(() => {
      this.pending = false;
      this.resolve("half");
    }, CONFIG.doublePressMs);
  }
  cancel() {
    this.timer.clear(this.holdTimer);
    this.timer.clear(this.singleTimer);
    this.pressed = false;
    this.pending = false;
    this.second = false;
    this.held = false;
  }
}
