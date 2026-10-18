import { HassEntity } from 'home-assistant-js-websocket';
import Store from '../../model/store';
import { MediaPlayer } from '../../model/media-player';
import { getGroupPlayerIds, getSpeakerList } from '../../utils/utils';

// A group change that has been asked for but not yet seen in Home Assistant. `target` is the group leader at the
// moment of the tap, so the change can still be confirmed if the active speaker is switched while it's in flight.
export interface GroupOp {
  join: boolean;
  target: string;
}

export type PendingOps = Record<string, GroupOp>;
export type GroupErrors = Record<string, string>;

export type SwitcherControl = 'groupAll' | 'on' | 'off' | 'pending' | 'disabled';

export interface SwitcherRow {
  id: string;
  name: string;
  subtitle: string;
  playing: boolean;
  isActive: boolean;
  control: SwitcherControl;
  error?: string;
}

export interface GroupAllState {
  label: string;
  action: 'group' | 'ungroup';
  enabled: boolean;
}

export const JOIN_ERROR = "Couldn't group — try again";
export const UNJOIN_ERROR = "Couldn't ungroup — try again";

export function leaderOf(store: Store, playerId: string): MediaPlayer | undefined {
  return store.allGroups.find((group) => group.hasMember(playerId));
}

export function leaderIdOf(store: Store, playerId: string) {
  return leaderOf(store, playerId)?.id ?? playerId;
}

// The "usual order": the same order the card sorts entities in (config.entities, else entity id). allMediaPlayers is
// flattened group by group, so it reshuffles whenever grouping changes and can't be used as-is.
export function stableSpeakerOrder(store: Store): string[] {
  const configEntities = store.config.entities;
  const ids = store.allMediaPlayers.map((player) => player.id);
  if (configEntities?.length) {
    return ids.sort((a, b) => configEntities.indexOf(a) - configEntities.indexOf(b));
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

// Saved once when the dropdown opens: active speaker, then its group, then everyone else.
export function computeSwitcherOrder(store: Store): string[] {
  const activeId = store.activePlayer.id;
  const ids = stableSpeakerOrder(store).filter((id) => id !== activeId);
  const members = ids.filter((id) => store.activePlayer.hasMember(id));
  const rest = ids.filter((id) => !store.activePlayer.hasMember(id));
  return [activeId, ...members, ...rest];
}

// Done means Home Assistant reports the new membership, not that the service call returned.
export function isOpConfirmed(playerId: string, op: GroupOp, states: Record<string, HassEntity>) {
  const leader = states[op.target];
  if (!leader) {
    return false;
  }
  const members = getGroupPlayerIds(leader);
  return op.join ? members.includes(playerId) : !members.includes(playerId);
}

export function resolvePendingOps(pending: PendingOps, states: Record<string, HassEntity>): PendingOps {
  const remaining: PendingOps = {};
  for (const [id, op] of Object.entries(pending)) {
    if (!isOpConfirmed(id, op, states)) {
      remaining[id] = op;
    }
  }
  return remaining;
}

function leadsOtherGroup(store: Store, playerId: string) {
  if (playerId === store.activePlayer.id) {
    return false;
  }
  const group = store.allGroups.find((g) => g.id === playerId);
  return !!group && group.members.length > 1;
}

function isDisabled(store: Store, playerId: string) {
  return !!store.config.grouping?.disableMainSpeakers && leadsOtherGroup(store, playerId);
}

export function groupableIds(store: Store, pending: PendingOps): string[] {
  const active = store.activePlayer;
  return stableSpeakerOrder(store).filter((id) => id !== active.id && !active.hasMember(id) && !pending[id] && !isDisabled(store, id));
}

export function ungroupableIds(store: Store, pending: PendingOps): string[] {
  const active = store.activePlayer;
  return active.members.map((member) => member.id).filter((id) => id !== active.id && !pending[id]);
}

export function getGroupAllState(store: Store, pending: PendingOps): GroupAllState {
  const activeId = store.activePlayer.id;
  const ops = Object.values(pending).filter((op) => op.target === activeId);
  if (ops.some((op) => op.join)) {
    return { label: 'Grouping…', action: 'group', enabled: false };
  }
  if (ops.length) {
    return { label: 'Ungrouping…', action: 'ungroup', enabled: false };
  }
  if (store.activePlayer.members.length > 1) {
    return { label: 'Ungroup all', action: 'ungroup', enabled: true };
  }
  return { label: 'Group all', action: 'group', enabled: groupableIds(store, pending).length > 0 };
}

function playbackLabel(player: MediaPlayer, idleLabel: string) {
  const track = player.getCurrentTrack();
  if (player.isPlaying()) {
    return track ? `Playing — ${track}` : 'Playing';
  }
  return idleLabel;
}

function subtitleFor(store: Store, player: MediaPlayer): string {
  const active = store.activePlayer;
  const track = player.getCurrentTrack();
  if (player.id === active.id) {
    return playbackLabel(player, track ? `Paused — ${track}` : 'Idle');
  }
  if (active.hasMember(player.id)) {
    return 'In this group';
  }
  const leader = leaderOf(store, player.id);
  if (leader && leader.id !== player.id) {
    return `With ${leader.name}${leader.isPlaying() ? ` · ${playbackLabel(leader, '')}` : ''}`;
  }
  if (leadsOtherGroup(store, player.id)) {
    const size = leader?.members.length ?? 1;
    const playback = player.isPlaying() ? playbackLabel(player, '') : track;
    return [playback, `Group of ${size}`].filter(Boolean).join(' · ');
  }
  return playbackLabel(player, 'Idle');
}

function controlFor(store: Store, playerId: string, pending: PendingOps): SwitcherControl {
  if (playerId === store.activePlayer.id) {
    return 'groupAll';
  }
  if (pending[playerId]) {
    return 'pending';
  }
  if (isDisabled(store, playerId)) {
    return 'disabled';
  }
  return store.activePlayer.hasMember(playerId) ? 'on' : 'off';
}

export function buildSwitcherRows(store: Store, order: string[], pending: PendingOps, errors: GroupErrors): SwitcherRow[] {
  // Speakers that appeared after the dropdown opened go at the end; ones that disappeared are dropped.
  const current = stableSpeakerOrder(store);
  const ids = [...order.filter((id) => current.includes(id)), ...current.filter((id) => !order.includes(id))];
  return ids.map((id) => {
    const player = store.allMediaPlayers.find((p) => p.id === id)!;
    const isActive = id === store.activePlayer.id;
    return {
      id,
      name: isActive ? getSpeakerList(store.activePlayer, store.predefinedGroups) : player.name,
      subtitle: subtitleFor(store, player),
      playing: !!leaderOf(store, id)?.isPlaying(),
      isActive,
      control: controlFor(store, id, pending),
      error: errors[id],
    };
  });
}
