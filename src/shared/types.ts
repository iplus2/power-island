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
export type BuildingView = Omit<Building, "power" | "productionTick"> & {
  power?: number;
};
export type Input = { x: number; y: number; sprint?: boolean; target?: Point };
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
export type PlayerView = Omit<
  Player,
  "zone" | "order" | "placementAt" | "disconnectedAt"
>;
export type TutorialPart = 1 | 2 | 3 | 4;
export type TutorialStage =
  | "place"
  | "move"
  | "half"
  | "max"
  | "deposit"
  | "firstPlant"
  | "fort"
  | "chase"
  | "frontier"
  | "enemyPlant"
  | "enemyFort"
  | "core"
  | "complete";
export type TutorialView = {
  part: TutorialPart;
  stage: TutorialStage;
  markers: (Point & { label: string })[];
};
export type Snapshot = {
  code: string;
  mode: Mode;
  phase: Phase;
  mapVersion: string;
  tick: number;
  serverTime: number;
  selfId: string;
  hostId?: string;
  boundary: Point[];
  players: PlayerView[];
  buildings: BuildingView[];
  swapRequests: { fromId: string; toId: string }[];
  roster: Roster[];
  zones: { id: string; teamId: TeamId; zone: number }[];
  vision: (Point & { radius: number })[];
  targetId?: string;
  result?: Result;
  notice?: string;
  tutorial?: TutorialView;
};
export type Reply = {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
  token?: string;
};

// Dynamic vision-filtered state is always complete. Public geometry and room
// metadata are sent on initialization/change, on the same reliable channel.
export type RoomView = Pick<
  Snapshot,
  | "code"
  | "mode"
  | "selfId"
  | "hostId"
  | "roster"
  | "zones"
  | "swapRequests"
  | "result"
  | "notice"
>;
export type StatePacket = Omit<Snapshot, keyof RoomView | "boundary"> & {
  boundary?: Point[];
  room?: RoomView;
};
export function restoreSnapshot(
  packet: StatePacket,
  previous?: Snapshot,
): Snapshot | undefined {
  const boundary =
    packet.boundary ??
    (previous?.mapVersion === packet.mapVersion
      ? previous.boundary
      : undefined);
  const room =
    packet.room ??
    (previous && {
      code: previous.code,
      mode: previous.mode,
      selfId: previous.selfId,
      hostId: previous.hostId,
      roster: previous.roster,
      zones: previous.zones,
      swapRequests: previous.swapRequests,
      result: previous.result,
      notice: previous.notice,
    });
  if (!boundary || !room) return;
  const { room: _metadata, boundary: _geometry, ...dynamic } = packet;
  return { ...room, ...dynamic, boundary };
}
