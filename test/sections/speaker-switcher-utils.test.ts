import { describe, expect, it } from 'vitest';
import { HomeAssistant } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';
import Store from '../../src/model/store';
import { CardConfig, Section } from '../../src/types';
import {
  buildSwitcherRows,
  computeSwitcherOrder,
  getGroupAllState,
  groupableIds,
  isOpConfirmed,
  JOIN_ERROR,
  resolvePendingOps,
  stableSpeakerOrder,
  ungroupableIds,
} from '../../src/sections/player/speaker-switcher-utils';

const LIVING = 'media_player.living';
const KITCHEN = 'media_player.kitchen';
const BEDROOM = 'media_player.bedroom';
const OFFICE = 'media_player.office';
const PATIO = 'media_player.patio';

function speaker(entityId: string, name: string, state: string, groupMembers: string[], title?: string) {
  return {
    entity_id: entityId,
    state,
    attributes: { friendly_name: name, group_members: groupMembers, media_title: title },
  } as unknown as HassEntity;
}

// Living Room leads Kitchen and is playing; Bedroom leads Office and is paused; Patio is on its own.
function defaultStates(): Record<string, HassEntity> {
  return {
    [LIVING]: speaker(LIVING, 'Living Room', 'playing', [LIVING, KITCHEN], 'Morning Mix'),
    [KITCHEN]: speaker(KITCHEN, 'Kitchen', 'playing', [LIVING, KITCHEN], 'Morning Mix'),
    [BEDROOM]: speaker(BEDROOM, 'Bedroom', 'paused', [BEDROOM, OFFICE], 'Deep Focus'),
    [OFFICE]: speaker(OFFICE, 'Office', 'paused', [BEDROOM, OFFICE], 'Deep Focus'),
    [PATIO]: speaker(PATIO, 'Patio', 'idle', [PATIO]),
  };
}

// Not imported from utils.test: importing a test file re-registers all of its tests here.
function newConfig(config: Partial<CardConfig>): CardConfig {
  return { type: 'custom:sonos-card', sections: [], ...config };
}

function createStore(activeId: string, states = defaultStates(), config: Partial<CardConfig> = {}) {
  const hass = { states } as unknown as HomeAssistant;
  const cardConfig = newConfig({ entities: [LIVING, KITCHEN, BEDROOM, OFFICE, PATIO], ...config });
  return new Store(hass, cardConfig, Section.PLAYER, {} as Element, activeId);
}

describe('speaker switcher', () => {
  describe('order', () => {
    it('uses the configured entity order regardless of grouping', () => {
      expect(stableSpeakerOrder(createStore(LIVING))).toEqual([LIVING, KITCHEN, BEDROOM, OFFICE, PATIO]);
    });

    it('puts the active speaker first, then its group, then everyone else', () => {
      expect(computeSwitcherOrder(createStore(BEDROOM))).toEqual([BEDROOM, OFFICE, LIVING, KITCHEN, PATIO]);
    });
  });

  describe('rows', () => {
    it('shows names, subtitles and controls for every relationship to the active group', () => {
      const store = createStore(LIVING);
      const rows = buildSwitcherRows(store, computeSwitcherOrder(store), {}, {});
      expect(rows.map((r) => [r.id, r.name, r.subtitle, r.control, r.playing])).toEqual([
        [LIVING, 'Living Room + Kitchen', 'Playing — Morning Mix', 'groupAll', true],
        [KITCHEN, 'Kitchen', 'In this group', 'on', true],
        [BEDROOM, 'Bedroom', 'Deep Focus · Group of 2', 'off', false],
        [OFFICE, 'Office', 'With Bedroom', 'off', false],
        [PATIO, 'Patio', 'Idle', 'off', false],
      ]);
    });

    it('mentions what the other group is playing on its members', () => {
      const states = defaultStates();
      states[BEDROOM] = speaker(BEDROOM, 'Bedroom', 'playing', [BEDROOM, OFFICE], 'Deep Focus');
      const store = createStore(LIVING, states);
      const office = buildSwitcherRows(store, computeSwitcherOrder(store), {}, {}).find((r) => r.id === OFFICE);
      expect(office?.subtitle).toBe('With Bedroom · Playing — Deep Focus');
    });

    it('keeps the saved order while the dropdown is open, even after grouping changes', () => {
      const store = createStore(LIVING);
      const savedOrder = [LIVING, PATIO, KITCHEN, BEDROOM, OFFICE];
      expect(buildSwitcherRows(store, savedOrder, {}, {}).map((r) => r.id)).toEqual(savedOrder);
    });

    it('drops speakers that disappeared and appends new ones', () => {
      const store = createStore(LIVING);
      const rows = buildSwitcherRows(store, [LIVING, 'media_player.gone', KITCHEN], {}, {});
      expect(rows.map((r) => r.id)).toEqual([LIVING, KITCHEN, BEDROOM, OFFICE, PATIO]);
    });

    it('shows pending and error state per speaker', () => {
      const store = createStore(LIVING);
      const rows = buildSwitcherRows(store, computeSwitcherOrder(store), { [PATIO]: { join: true, target: LIVING } }, { [OFFICE]: JOIN_ERROR });
      expect(rows.find((r) => r.id === PATIO)?.control).toBe('pending');
      expect(rows.find((r) => r.id === OFFICE)?.error).toBe(JOIN_ERROR);
    });

    it('disables leaders of other groups only when disableMainSpeakers is set', () => {
      const store = createStore(LIVING, defaultStates(), { grouping: { disableMainSpeakers: true } });
      const rows = buildSwitcherRows(store, computeSwitcherOrder(store), {}, {});
      expect(rows.find((r) => r.id === BEDROOM)?.control).toBe('disabled');
      expect(rows.find((r) => r.id === OFFICE)?.control).toBe('off');
      expect(groupableIds(store, {})).toEqual([OFFICE, PATIO]);
    });
  });

  describe('group all / ungroup all', () => {
    it('offers Ungroup all when the active speaker is grouped', () => {
      const store = createStore(LIVING);
      expect(getGroupAllState(store, {})).toEqual({ label: 'Ungroup all', action: 'ungroup', enabled: true });
      expect(ungroupableIds(store, {})).toEqual([KITCHEN]);
    });

    it('offers Group all when alone, adding everyone not already waiting', () => {
      const store = createStore(PATIO);
      expect(getGroupAllState(store, {})).toEqual({ label: 'Group all', action: 'group', enabled: true });
      expect(groupableIds(store, { [KITCHEN]: { join: true, target: PATIO } })).toEqual([LIVING, BEDROOM, OFFICE]);
    });

    it('shows progress and blocks a second tap while changes are waiting', () => {
      const store = createStore(PATIO);
      expect(getGroupAllState(store, { [KITCHEN]: { join: true, target: PATIO } })).toMatchObject({ label: 'Grouping…', enabled: false });
      expect(getGroupAllState(createStore(LIVING), { [KITCHEN]: { join: false, target: LIVING } })).toMatchObject({
        label: 'Ungrouping…',
        enabled: false,
      });
    });

    it('ignores waiting changes that target a different group', () => {
      const store = createStore(PATIO);
      expect(getGroupAllState(store, { [KITCHEN]: { join: false, target: LIVING } }).label).toBe('Group all');
    });
  });

  describe('confirmation', () => {
    it('confirms a join only once the leader reports the new member', () => {
      const op = { join: true, target: LIVING };
      expect(isOpConfirmed(PATIO, op, defaultStates())).toBe(false);
      const states = defaultStates();
      states[LIVING] = speaker(LIVING, 'Living Room', 'playing', [LIVING, KITCHEN, PATIO]);
      expect(isOpConfirmed(PATIO, op, states)).toBe(true);
    });

    it('confirms an unjoin once the leader no longer lists the speaker', () => {
      const op = { join: false, target: LIVING };
      expect(isOpConfirmed(KITCHEN, op, defaultStates())).toBe(false);
      const states = defaultStates();
      states[LIVING] = speaker(LIVING, 'Living Room', 'playing', [LIVING]);
      expect(isOpConfirmed(KITCHEN, op, states)).toBe(true);
    });

    it('keeps only unconfirmed changes pending', () => {
      const states = defaultStates();
      states[LIVING] = speaker(LIVING, 'Living Room', 'playing', [LIVING, KITCHEN, PATIO]);
      const pending = { [PATIO]: { join: true, target: LIVING }, [OFFICE]: { join: true, target: LIVING } };
      expect(Object.keys(resolvePendingOps(pending, states))).toEqual([OFFICE]);
    });
  });
});
