import { css, html, LitElement, nothing, PropertyValues, svg } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import Store from '../../model/store';
import { dispatchActivePlayerId, getSpeakerList, openCta } from '../../utils/utils';
import { until } from 'lit-html/directives/until.js';
import { when } from 'lit/directives/when.js';
import { styleMap } from 'lit/directives/style-map.js';
import { mdiChevronDown, mdiOpenInNew, mdiPause, mdiPlay, mdiSpeaker, mdiSpotify, mdiStop } from '@mdi/js';
import { isOpening, placeBelowOrAbove } from '../../utils/popover-utils';
import {
  buildSwitcherRows,
  computeSwitcherOrder,
  getGroupAllState,
  GroupErrors,
  groupableIds,
  GroupOp,
  JOIN_ERROR,
  leaderIdOf,
  PendingOps,
  resolvePendingOps,
  SwitcherRow,
  ungroupableIds,
  UNJOIN_ERROR,
} from './speaker-switcher-utils';
import '../../components/playing-bars';
import '../../components/icon-button';
import './player-favorite-button';

// Matches the 30s the grouping section waits for Sonos before giving up.
const GROUP_OP_TIMEOUT = 30_000;
const ERROR_DISPLAY_TIME = 4_000;
// Below this the switcher row is too narrow for name + group control, so the dropdown spans the card instead.
const MIN_DROPDOWN_WIDTH = 280;

const iconOn = svg`<circle cx="12" cy="12" r="10" fill="currentColor"></circle><polyline points="7.5,12.5 10.5,15.5 16.5,9" fill="none" stroke="var(--card-background-color)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></polyline>`;
const iconOff = svg`<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-opacity="0.4" stroke-width="2"></circle><line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>`;
const iconDisabled = svg`<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"></circle>`;

class PlayerHeader extends LitElement {
  @property({ attribute: false }) store!: Store;
  @state() private switcherOpen = false;
  @state() private order?: string[];
  @state() private pending: PendingOps = {};
  @state() private errors: GroupErrors = {};
  @query('#switcher') private switcherPopover?: HTMLElement;
  @query('.switcher-container') private switcherContainer?: HTMLElement;
  // Every join/unjoin goes through this one chain so Sonos only ever sees one group change at a time.
  private opQueue: Promise<void> = Promise.resolve();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  disconnectedCallback() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    window.removeEventListener('resize', this.closeSwitcher);
    super.disconnectedCallback();
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('store') && Object.keys(this.pending).length) {
      const remaining = resolvePendingOps(this.pending, this.store.hass.states);
      if (Object.keys(remaining).length !== Object.keys(this.pending).length) {
        this.pending = remaining;
      }
    }
  }

  render() {
    const { headerEntityFontSize, headerSongFontSize, hideEntityName, hideArtistAlbum, showAudioInputFormat, stopInsteadOfPause } =
      this.store.config.player ?? {};
    const entityStyle = headerEntityFontSize ? { fontSize: `${headerEntityFontSize}rem` } : {};
    const songStyle = headerSongFontSize ? { fontSize: `${headerSongFontSize}rem` } : {};
    const activePlayer = this.store.activePlayer;
    const playing = activePlayer.isPlaying();
    const playPauseIcon = playing ? (stopInsteadOfPause ? mdiStop : mdiPause) : mdiPlay;
    const canSwitch = this.store.allMediaPlayers.length > 1;

    return html`
      <div class="switcher-container" ?hidden=${!!hideEntityName}>
        <div class="switcher-row">
          <button class="switcher-button" popovertarget=${canSwitch ? 'switcher' : nothing} style=${styleMap(entityStyle)}>
            <ha-svg-icon class="speaker-icon" .path=${mdiSpeaker}></ha-svg-icon>
            <div class="switcher-label">Speaker</div>
            <div class="switcher-name">
              <span class="switcher-name-text">${getSpeakerList(activePlayer, this.store.predefinedGroups)}</span>
              ${when(canSwitch, () => html`<ha-svg-icon class="chevron" .path=${mdiChevronDown}></ha-svg-icon>`)}
            </div>
          </button>
          <sonos-playing-bars .show=${playing}></sonos-playing-bars>
          ${this.renderCtaPill()}
        </div>
        <div id="switcher" popover @beforetoggle=${this.onSwitcherBeforeToggle} @toggle=${this.onSwitcherToggle}>
          ${when(this.switcherOpen, () => this.renderSwitcherRows())}
        </div>
      </div>

      <div class="title-row">
        <div class="titles">
          <div class="song" style=${styleMap(songStyle)}>${this.getSong()}</div>
          <div class="artist-album" ?hidden=${!!hideArtistAlbum}>${this.getAlbum()} ${when(showAudioInputFormat, () => until(this.getAudioInputFormat()))}</div>
        </div>
        <sonos-player-favorite-button .store=${this.store}></sonos-player-favorite-button>
        <sonos-icon-button class="play-pause" @click=${this.playPauseHandler} .path=${playPauseIcon}></sonos-icon-button>
      </div>
    `;
  }

  // Compact (W-size) stand-in for the full-width CTA button, which has no room at 188px tall.
  private renderCtaPill() {
    const { ctaButtonColor, ctaButtonLabel, ctaButtonNavigationPath } = this.store.config.player ?? {};
    if (!ctaButtonNavigationPath) {
      return nothing;
    }
    const label = (ctaButtonLabel || 'Open Spotify').replace(/^open\s+/i, '');
    return html`
      <button
        class="cta-pill"
        style=${ctaButtonColor ? `--cta-color: ${ctaButtonColor}` : nothing}
        title=${ctaButtonLabel || 'Open Spotify'}
        @click=${() => openCta(this, this.store.activePlayer, ctaButtonNavigationPath)}
      >
        <ha-svg-icon class="cta-logo" .path=${mdiSpotify}></ha-svg-icon>
        ${label}
        <ha-svg-icon .path=${mdiOpenInNew}></ha-svg-icon>
      </button>
    `;
  }

  private renderSwitcherRows() {
    const showGroupControls = this.store.config.player?.switcherGrouping !== false;
    const rows = buildSwitcherRows(this.store, this.order ?? computeSwitcherOrder(this.store), this.pending, this.errors);
    return rows.map(
      (row) => html`
        <div class="item">
          <div class="item-row">
            <div class="item-main ${row.isActive ? 'active' : ''}" @click=${() => this.selectSpeaker(row.id)}>
              <div class="item-bars"><sonos-playing-bars .show=${row.playing}></sonos-playing-bars></div>
              <div class="item-text">
                <div class="item-name">${row.name}</div>
                <div class="item-subtitle" ?hidden=${!row.subtitle}>${row.subtitle}</div>
              </div>
            </div>
            ${when(showGroupControls, () => html`<div class="item-control">${this.renderControl(row)}</div>`)}
          </div>
          ${when(row.error, () => html`<div class="item-error">${row.error}</div>`)}
        </div>
      `,
    );
  }

  private renderControl(row: SwitcherRow) {
    switch (row.control) {
      case 'groupAll': {
        const { label, enabled } = getGroupAllState(this.store, this.pending);
        return html`<button class="group-all" ?disabled=${!enabled} @click=${this.groupAllHandler}>${label}</button>`;
      }
      case 'pending':
        return html`<div class="spinner" role="status" aria-label="Waiting for Sonos"></div>`;
      case 'disabled':
        return html`<div class="group-toggle disabled" title="Leads another group"><svg viewBox="0 0 24 24">${iconDisabled}</svg></div>`;
      case 'on':
        return html`<button class="group-toggle" title="Remove from group" @click=${() => this.toggleGroup(row.id)}>
          <svg viewBox="0 0 24 24">${iconOn}</svg>
        </button>`;
      case 'off':
        return html`<button class="group-toggle" title="Add to group" @click=${() => this.toggleGroup(row.id)}>
          <svg viewBox="0 0 24 24">${iconOff}</svg>
        </button>`;
    }
  }

  private onSwitcherBeforeToggle = (event: Event) => {
    if (isOpening(event)) {
      this.order = computeSwitcherOrder(this.store);
      this.switcherOpen = true;
      this.positionSwitcher();
      window.addEventListener('resize', this.closeSwitcher);
    }
  };

  private onSwitcherToggle = (event: Event) => {
    if (isOpening(event)) {
      // Rows have rendered by now, so the real height is known and it can flip above if needed.
      this.positionSwitcher();
    } else {
      this.switcherOpen = false;
      this.order = undefined;
      window.removeEventListener('resize', this.closeSwitcher);
    }
  };

  private positionSwitcher() {
    if (!this.switcherPopover || !this.switcherContainer) {
      return;
    }
    const anchor = this.switcherContainer.getBoundingClientRect();
    let { left, width } = anchor;
    if (width < MIN_DROPDOWN_WIDTH) {
      // The card is the player section's .card; inset the dropdown by the card's own padding.
      const card = (this.getRootNode() as ShadowRoot).querySelector?.('.card');
      if (card) {
        const rect = card.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(card).paddingLeft) || 0;
        left = rect.left + padding;
        width = rect.width - 2 * padding;
      }
    }
    placeBelowOrAbove(this.switcherPopover, anchor, left, width);
  }

  private closeSwitcher = () => this.switcherPopover?.hidePopover();

  private selectSpeaker(playerId: string) {
    this.closeSwitcher();
    const active = this.store.activePlayer;
    if (playerId !== active.id && !active.hasMember(playerId)) {
      dispatchActivePlayerId(leaderIdOf(this.store, playerId), this.store.config, this);
    }
  }

  private toggleGroup(playerId: string) {
    if (this.pending[playerId]) {
      return;
    }
    this.runGroupOps([playerId], !this.store.activePlayer.hasMember(playerId));
  }

  private groupAllHandler = () => {
    const { action, enabled } = getGroupAllState(this.store, this.pending);
    if (!enabled) {
      return;
    }
    if (action === 'group') {
      this.runGroupOps(groupableIds(this.store, this.pending), true);
    } else {
      this.runGroupOps(ungroupableIds(this.store, this.pending), false);
    }
  };

  // One service call per speaker, run one after another, never retried. A failure or timeout shows an error on
  // that row and stops there (a retry loop in another card once saturated HA's websocket and froze the frontend).
  private runGroupOps(playerIds: string[], join: boolean) {
    if (!playerIds.length) {
      return;
    }
    const target = this.store.activePlayer.id;
    const ops = playerIds.map((id) => [id, { join, target }] as [string, GroupOp]);
    const errors = { ...this.errors };
    playerIds.forEach((id) => delete errors[id]);
    this.errors = errors;
    this.pending = { ...this.pending, ...Object.fromEntries(ops) };

    for (const [id, op] of ops) {
      this.later(() => this.failOp(id, op), GROUP_OP_TIMEOUT);
      this.opQueue = this.opQueue.then(async () => {
        if (this.pending[id] !== op) {
          return;
        }
        try {
          const mediaControlService = this.store.mediaControlService;
          if (join) {
            await mediaControlService.join(target, [id], false);
          } else {
            await mediaControlService.unJoin([id], false);
          }
        } catch (e) {
          console.warn(`Sonos card: ${join ? 'join' : 'unjoin'} failed for ${id}`, e);
          this.failOp(id, op);
        }
      });
    }
  }

  private failOp(playerId: string, op: GroupOp) {
    if (this.pending[playerId] !== op) {
      // Already confirmed, or superseded by a newer tap.
      return;
    }
    const pending = { ...this.pending };
    delete pending[playerId];
    this.pending = pending;
    const message = op.join ? JOIN_ERROR : UNJOIN_ERROR;
    this.errors = { ...this.errors, [playerId]: message };
    this.later(() => {
      if (this.errors[playerId] === message) {
        const errors = { ...this.errors };
        delete errors[playerId];
        this.errors = errors;
      }
    }, ERROR_DISPLAY_TIME);
  }

  private later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delay);
    this.timers.add(timer);
  }

  private playPauseHandler = async () => await this.store.mediaControlService.togglePlayPause(this.store.activePlayer);

  private getSong() {
    const { labelWhenNoMediaIsSelected, showSource } = this.store.config.player ?? {};
    let song = this.store.activePlayer.getCurrentTrack();
    song = song || labelWhenNoMediaIsSelected || 'No media selected';
    if (showSource && this.store.activePlayer.attributes.source) {
      song = `${song} (${this.store.activePlayer.attributes.source})`;
    }
    return song;
  }

  private getAlbum() {
    const { showChannel, hidePlaylist } = this.store.config.player ?? {};
    let album = this.store.activePlayer.attributes.media_album_name;
    if (showChannel && this.store.activePlayer.attributes.media_channel) {
      album = this.store.activePlayer.attributes.media_channel;
    } else if (!hidePlaylist && this.store.activePlayer.attributes.media_playlist) {
      album = `${this.store.activePlayer.attributes.media_playlist} - ${album}`;
    }
    return album;
  }

  private async getAudioInputFormat() {
    const sensors = await this.store.hassService.getRelatedEntities(this.store.activePlayer, 'sensor');
    const audioInputFormat = sensors.find((sensor) => sensor.entity_id.includes('audio_input_format'));
    return audioInputFormat && audioInputFormat.state && audioInputFormat.state !== 'No audio'
      ? html`<span class="audio-input-format">${audioInputFormat.state}</span>`
      : nothing;
  }

  static get styles() {
    return css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
      }

      [hidden] {
        display: none !important;
      }

      .switcher-container {
        position: relative;
        min-width: 0;
      }

      .switcher-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .switcher-button {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        text-align: left;
        color: inherit;
        font: inherit;
        min-width: 0;
      }

      .speaker-icon {
        --mdc-icon-size: calc(var(--sonos-font-size, 1rem) * 1.15);
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }

      .switcher-label {
        font-size: calc(var(--sonos-font-size, 1rem) * 0.8);
        color: var(--secondary-text-color);
        letter-spacing: 0.02em;
      }

      .switcher-name {
        font-size: calc(var(--sonos-font-size, 1rem) * 1.25);
        font-weight: 600;
        color: var(--primary-text-color);
        display: flex;
        align-items: center;
        gap: 0.375rem;
        min-width: 0;
      }

      .switcher-name-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .chevron {
        --mdc-icon-size: 0.9rem;
        opacity: 0.5;
        flex-shrink: 0;
      }

      sonos-playing-bars {
        flex-shrink: 0;
      }

      .cta-pill {
        --cta-color: #1db954;
        display: none;
        flex-shrink: 0;
        align-items: center;
        gap: 0.3rem;
        height: 1.85rem;
        padding: 0 0.7rem;
        border: none;
        border-radius: 0.925rem;
        background: color-mix(in srgb, var(--cta-color) 18%, transparent);
        color: var(--cta-color);
        font: inherit;
        font-size: calc(var(--sonos-font-size, 1rem) * 0.8);
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }

      .cta-pill ha-svg-icon {
        --mdc-icon-size: 0.8rem;
      }

      .cta-pill .cta-logo {
        --mdc-icon-size: 1.05rem;
      }

      /* Top-layer popover: the UA defaults centre it with a border and system colours, so reset all of that.
         Position and size are set inline by positionSwitcher(). */
      #switcher {
        inset: auto;
        margin: 0;
        border: none;
        box-sizing: border-box;
        padding: 0.5rem;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border-radius: 1.25rem;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
        overflow-y: auto;
        font-family: inherit;
      }

      .item-row {
        display: flex;
        align-items: center;
        gap: 0.125rem;
      }

      .item-main {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.7rem;
        padding: 0.55rem 0.7rem;
        border-radius: 0.85rem;
        cursor: pointer;
      }

      .item-main:hover {
        background: rgba(var(--rgb-primary-text-color), 0.05);
      }

      .item-bars {
        width: 1rem;
        flex-shrink: 0;
        display: flex;
        justify-content: center;
      }

      .item-text {
        min-width: 0;
        flex: 1;
      }

      .item-name {
        font-size: calc(var(--sonos-font-size, 1rem) * 0.93);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .item-main.active .item-name {
        font-weight: 700;
      }

      .item-subtitle {
        font-size: calc(var(--sonos-font-size, 1rem) * 0.79);
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Fixed 80 x 44 slot so every control state takes the same room and nothing shifts. */
      .item-control {
        width: 5.7rem;
        height: 3.15rem;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .group-toggle {
        width: 3.15rem;
        height: 3.15rem;
        border-radius: 50%;
        border: none;
        padding: 0;
        background: none;
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }

      .group-toggle:hover {
        background: rgba(var(--rgb-primary-text-color), 0.05);
      }

      .group-toggle svg {
        width: 1.55rem;
        height: 1.55rem;
      }

      .group-toggle.disabled {
        cursor: default;
        opacity: 0.35;
      }

      .group-toggle.disabled:hover {
        background: none;
      }

      .group-all {
        height: 2rem;
        padding: 0 0.85rem;
        border-radius: 1rem;
        border: none;
        background: rgba(var(--rgb-primary-text-color), 0.06);
        color: var(--primary-text-color);
        font: inherit;
        font-size: calc(var(--sonos-font-size, 1rem) * 0.79);
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
      }

      .group-all:hover {
        background: rgba(var(--rgb-primary-text-color), 0.1);
      }

      .group-all:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .spinner {
        width: 1.3rem;
        height: 1.3rem;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid rgba(var(--rgb-primary-text-color), 0.12);
        border-top-color: var(--primary-text-color);
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .item-error {
        padding: 0 0.7rem 0.45rem 2.4rem;
        font-size: calc(var(--sonos-font-size, 1rem) * 0.79);
        font-weight: 500;
        color: var(--error-color, #db4437);
      }

      .title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }

      .titles {
        min-width: 0;
      }

      .song {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: calc(var(--sonos-font-size, 1rem) * 1.4);
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .artist-album {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--sonos-font-size, 1rem);
        font-weight: 400;
        color: var(--secondary-text-color);
      }

      .audio-input-format {
        color: var(--card-background-color);
        background: var(--disabled-text-color);
        white-space: nowrap;
        font-size: smaller;
        line-height: normal;
        padding: 3px;
        margin-left: 8px;
      }

      .play-pause {
        flex-shrink: 0;
        --icon-button-size: 3.25rem;
        --icon-size: 1.35rem;
        --icon-button-background: var(--primary-text-color);
        color: var(--card-background-color);
      }

      /* Compact landscape: the W size (384x188). Must match the query in player-section.styles.ts.
         The header dissolves into the info column (display: contents) so the column can space the switcher,
         titles, progress and buttons evenly; play/pause moves to the controls row and the CTA becomes a pill. */
      @container (aspect-ratio > 1) and (max-height: 20rem) {
        :host {
          display: contents;
        }

        .switcher-label,
        .switcher-row sonos-playing-bars,
        .title-row .play-pause {
          display: none;
        }

        .switcher-button {
          gap: 0.35rem;
        }

        .speaker-icon {
          --mdc-icon-size: calc(var(--sonos-font-size, 1rem) * 1.07);
        }

        .switcher-name {
          font-size: var(--sonos-font-size, 1rem);
          color: var(--secondary-text-color);
          gap: 0.3rem;
        }

        .chevron {
          --mdc-icon-size: 0.85rem;
        }

        .cta-pill {
          display: flex;
        }

        .song {
          font-size: calc(var(--sonos-font-size, 1rem) * 1.15);
          line-height: 1.25;
        }

        .artist-album {
          font-size: calc(var(--sonos-font-size, 1rem) * 0.86);
          line-height: 1.3;
        }
      }
    `;
  }
}

customElements.define('sonos-player-header', PlayerHeader);
