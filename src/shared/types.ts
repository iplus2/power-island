export type Mode = "1v1" | "2v2";
export type TeamId = 0 | 1;
export type Point = { x: number; y: number };
export type BuildingKind = "core" | "plant" | "fort";
export type Phase = "lobby" | "placement" | "playing" | "finished";
export type Command = "half" | "max" | "deposit" | "attack";
export type Building = Point & {
  id: string;
  kind: BuildingKind;
  teamId: TeamId | null;
  ownerId?: string;
  power: number;
  productionTick: number;
};
export type Player = Point & {
  id: string;
  name: string;
  teamId: TeamId;
  order: number;
  zone: number;
  power: number;
  alive: boolean;
  connected: boolean;
  coreId?: string;
  sprintTicks: number;
  disconnectedAt?: number;
  placementAt?: number;
};
export type BuildingView = Omit<Building, "power"> & { power?: number };
export type Input = { x: number; y: number; sprint?: boolean };
export type Action = { playerId: string; targetId: string; kind: Command };
export type Result = {
  winner: TeamId | null;
  totals: [number, number];
  reason: string;
};
export type Match = {
  code: string;
  mode: Mode;
  phase: Phase;
  seed: number;
  tick: number;
  players: Player[];
  buildings: Building[];
  boundary: Point[];
  result?: Result;
  startedAt?: number;
  notices: Record<string, string>;
};
export type Roster = Pick<
  Player,
  "id" | "name" | "teamId" | "alive" | "connected"
> & { placed: boolean; timeoutRemaining?: number };
export type Snapshot = {
  code: string;
  mode: Mode;
  phase: Phase;
  seed: number;
  tick: number;
  serverTime: number;
  selfId: string;
  hostId?: string;
  boundary: Point[];
  players: Player[];
  buildings: BuildingView[];
  swapRequests: { fromId: string; toId: string }[];
  roster: Roster[];
  zones: { id: string; teamId: TeamId; zone: number }[];
  vision: (Point & { radius: number })[];
  targetId?: string;
  result?: Result;
  notice?: string;
};
export type Reply = {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  token?: string;
};
