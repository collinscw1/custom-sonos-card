import { css, html, LitElement, nothing, PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { when } from 'lit/directives/when.js';
import { styleMap } from 'lit/directives/style-map.js';
import Store from '../../model/store';
import { mdiMinus, mdiOpenInNew, mdiPause, mdiPlay, mdiPlus, mdiSkipNext, mdiSkipPrevious, mdiSpotify, mdiStop, mdiVolumeHigh } from '@mdi/js';
import { findPlayer, openCta } from '../../utils/utils';
import { isOpening, placeAbove } from '../../utils/popover-utils';
import { MediaPlayer } from '../../model/media-player';
import './player-progress';
import '../../components/icon-button';
import '../../components/shuffle';

const VOLUME_POPOVER_WIDTH = 220;
// How long a tapped/dragged volume is shown before falling back to what HA reports, if HA never catches up.
const OPTIMISTIC_VOLUME_TIMEOUT = 3_000;

class PlayerControls extends LitElement {
  @property({ attribute: false }) store!: Store;
  @state() private volumeOpen = false;
  // Volume shown while HA hasn't reported the change yet. Also the base for the next +/- tap, so quick
  // repeated taps add up instead of all starting from the same stale value.
  @state() private optimisticVolume?: number;
  @state() private draggingVolume = false;
  @query('#volume') private volumePopover?: HTMLElement;
  @query('.volume-button') private volumeButton?: HTMLElement;
  @query('.volume-track') private volumeTrack?: HTMLElement;
  private optimisticTimer?: ReturnType<typeof setTimeout>;
  private onVolumePointerMove?: (e: PointerEvent) => void;
  private onVolumePointerUp?: () => void;

  disconnectedCallback() {
    clearTimeout(this.optimisticTimer);
    this.detachVolumeDragListeners();
    super.disconnectedCallback();
  }

  protected willUpdate(changedProperties: PropertyValues) {
    if (changedProperties.has('store') && this.optimisticVolume !== undefined && !this.draggingVolume) {
      if (this.getVolumePlayer().getVolume() === this.optimisticVolume) {
        this.optimisticVolume = undefined;
      }
    }
  }

  render() {
    const {
      hideControlShuffleButton,
      hideControlPrevTrackButton,
      hideControlNextTrackButton,
      hideVolume,
      ctaButtonColor,
      ctaButtonLabel,
      ctaButtonNavigationPath,
      stopInsteadOfPause,
    } = this.store.config.player ?? {};
    const ctaColorStyle = ctaButtonColor ? `--cta-color: ${ctaButtonColor}` : '';
    const playing = this.store.activePlayer.isPlaying();
    const playPauseIcon = playing ? (stopInsteadOfPause ? mdiStop : mdiPause) : mdiPlay;

    return html`
      <sonos-progress .store=${this.store}></sonos-progress>
      <div class="buttons-row">
        <div class="volume-container" ?hidden=${!!hideVolume}>
          <button class="volume-button" popovertarget="volume" title="Volume" aria-label="Volume">
            <ha-svg-icon .path=${mdiVolumeHigh}></ha-svg-icon>
          </button>
          <div id="volume" popover @beforetoggle=${this.onVolumeBeforeToggle} @toggle=${this.onVolumeToggle}>
            ${when(this.volumeOpen, () => this.renderVolumePopover())}
          </div>
        </div>
        <div class="secondary-buttons">
          <sonos-shuffle class="round-button shuffle" ?hidden=${!!hideControlShuffleButton} .store=${this.store}></sonos-shuffle>
          <sonos-icon-button class="round-button prev" ?hidden=${!!hideControlPrevTrackButton} @click=${this.prev} .path=${mdiSkipPrevious}></sonos-icon-button>
          <sonos-icon-button class="play-pause" @click=${this.playPause} .path=${playPauseIcon}></sonos-icon-button>
          <sonos-icon-button class="round-button next" ?hidden=${!!hideControlNextTrackButton} @click=${this.next} .path=${mdiSkipNext}></sonos-icon-button>
        </div>
      </div>
      ${when(
        !!ctaButtonNavigationPath,
        () => html`
          <button class="cta-button" style=${ctaColorStyle || nothing} @click=${() => openCta(this, this.store.activePlayer, ctaButtonNavigationPath!)}>
            <ha-svg-icon class="cta-logo" .path=${mdiSpotify}></ha-svg-icon>
            ${ctaButtonLabel || 'Open Spotify'}
            <ha-svg-icon .path=${mdiOpenInNew}></ha-svg-icon>
          </button>
        `,
      )}
    `;
  }

  private renderVolumePopover() {
    const player = this.getVolumePlayer();
    const volume = this.optimisticVolume ?? player.getVolume();
    const disabled = player.ignoreVolume;
    return html`
      <div class="volume-label">Volume — ${volume}%</div>
      <div class="volume-row">
        <button class="volume-step" title="Volume down 1%" ?disabled=${disabled || volume <= 0} @click=${() => this.stepVolume(-1)}>
          <ha-svg-icon .path=${mdiMinus}></ha-svg-icon>
        </button>
        <div class="volume-track ${disabled ? 'disabled' : ''}" @pointerdown=${disabled ? nothing : this.handleVolumePointerDown}>
          <div class="volume-fill" style=${styleMap({ width: `${volume}%` })}></div>
          <div class="volume-thumb" style=${styleMap({ left: `${volume}%` })}></div>
        </div>
        <button class="volume-step" title="Volume up 1%" ?disabled=${disabled || volume >= 100} @click=${() => this.stepVolume(1)}>
          <ha-svg-icon .path=${mdiPlus}></ha-svg-icon>
        </button>
      </div>
    `;
  }

  private onVolumeBeforeToggle = (event: Event) => {
    if (isOpening(event)) {
      this.volumeOpen = true;
      this.positionVolume();
    }
  };

  private onVolumeToggle = (event: Event) => {
    if (!isOpening(event)) {
      this.volumeOpen = false;
      this.detachVolumeDragListeners();
      this.draggingVolume = false;
    }
  };

  private positionVolume() {
    if (!this.volumePopover || !this.volumeButton) {
      return;
    }
    const card = (this.getRootNode() as ShadowRoot).querySelector?.('.card');
    const rightLimit = card ? card.getBoundingClientRect().right : window.innerWidth;
    placeAbove(this.volumePopover, this.volumeButton.getBoundingClientRect(), VOLUME_POPOVER_WIDTH, rightLimit);
  }

  private stepVolume(delta: number) {
    const base = this.optimisticVolume ?? this.getVolumePlayer().getVolume();
    this.commitVolume(Math.max(0, Math.min(100, base + delta)));
  }

  // Dragging only moves the thumb locally; the service call happens once, on release.
  private handleVolumePointerDown = (e: PointerEvent) => {
    this.draggingVolume = true;
    this.updateVolumeFromEvent(e);
    this.onVolumePointerMove = (ev: PointerEvent) => this.updateVolumeFromEvent(ev);
    this.onVolumePointerUp = () => {
      this.detachVolumeDragListeners();
      this.draggingVolume = false;
      if (this.optimisticVolume !== undefined) {
        this.commitVolume(this.optimisticVolume);
      }
    };
    window.addEventListener('pointermove', this.onVolumePointerMove);
    window.addEventListener('pointerup', this.onVolumePointerUp);
  };

  private updateVolumeFromEvent(e: PointerEvent) {
    if (!this.volumeTrack) {
      return;
    }
    const rect = this.volumeTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.optimisticVolume = Math.round(ratio * 100);
  }

  private detachVolumeDragListeners() {
    if (this.onVolumePointerMove) {
      window.removeEventListener('pointermove', this.onVolumePointerMove);
    }
    if (this.onVolumePointerUp) {
      window.removeEventListener('pointerup', this.onVolumePointerUp);
    }
    this.onVolumePointerMove = undefined;
    this.onVolumePointerUp = undefined;
  }

  private async commitVolume(volume: number) {
    this.optimisticVolume = volume;
    clearTimeout(this.optimisticTimer);
    this.optimisticTimer = setTimeout(() => (this.optimisticVolume = undefined), OPTIMISTIC_VOLUME_TIMEOUT);
    const updateMembers = !this.store.config.player?.volumeEntityId;
    await this.store.mediaControlService.volumeSet(this.getVolumePlayer(), volume, updateMembers);
  }

  private prev = async () => await this.store.mediaControlService.prev(this.store.activePlayer);
  private next = async () => await this.store.mediaControlService.next(this.store.activePlayer);
  private playPause = async () => await this.store.mediaControlService.togglePlayPause(this.store.activePlayer);

  private getVolumePlayer(): MediaPlayer {
    const volumeEntityId = this.store.config.player?.volumeEntityId;
    if (volumeEntityId) {
      if (this.store.config.allowPlayerVolumeEntityOutsideOfGroup) {
        return findPlayer(this.store.allMediaPlayers, volumeEntityId) ?? this.store.activePlayer;
      }
      return this.store.activePlayer.getMember(volumeEntityId) ?? this.store.activePlayer;
    }
    return this.store.activePlayer;
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

      .buttons-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .volume-container {
        position: relative;
        display: flex;
      }

      .secondary-buttons {
        display: flex;
        gap: 0.625rem;
      }

      .round-button {
        --icon-button-size: 3rem;
        --icon-size: 1.15rem;
        --icon-button-background: rgba(var(--rgb-primary-text-color), 0.06);
        color: var(--primary-text-color);
      }

      /* A native <button> (popovertarget only works on one), styled to match sonos-icon-button. */
      .volume-button {
        width: var(--volume-button-size, 3rem);
        height: var(--volume-button-size, 3rem);
        border-radius: 50%;
        border: none;
        padding: 0;
        background: rgba(var(--rgb-primary-text-color), 0.06);
        color: var(--primary-text-color);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }

      .volume-button:hover {
        background: rgba(var(--rgb-primary-text-color), 0.11);
      }

      .volume-button ha-svg-icon {
        --mdc-icon-size: var(--volume-icon-size, 1.15rem);
      }

      /* Only shown in the compact layout; elsewhere play/pause lives in the header. */
      .play-pause {
        display: none;
        --icon-button-size: 2.85rem;
        --icon-size: 1.15rem;
        --icon-button-background: var(--primary-text-color);
        color: var(--card-background-color);
      }

      #volume {
        inset: auto;
        margin: 0;
        border: none;
        box-sizing: border-box;
        padding: 0.85rem 0.85rem 1rem;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        border-radius: 1rem;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
        overflow: visible;
        font-family: inherit;
      }

      .volume-label {
        font-size: calc(var(--sonos-font-size, 1rem) * 0.79);
        color: var(--secondary-text-color);
        margin-bottom: 0.6rem;
        font-variant-numeric: tabular-nums;
      }

      .volume-row {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }

      .volume-step {
        flex-shrink: 0;
        width: 2.15rem;
        height: 2.15rem;
        border-radius: 50%;
        border: none;
        padding: 0;
        background: rgba(var(--rgb-primary-text-color), 0.06);
        color: var(--primary-text-color);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        -webkit-tap-highlight-color: transparent;
      }

      .volume-step:hover {
        background: rgba(var(--rgb-primary-text-color), 0.11);
      }

      .volume-step:disabled {
        opacity: 0.38;
        cursor: default;
      }

      .volume-step ha-svg-icon {
        --mdc-icon-size: 0.95rem;
      }

      .volume-track {
        position: relative;
        flex: 1;
        height: 0.25rem;
        background: rgba(var(--rgb-primary-text-color), 0.12);
        border-radius: 0.125rem;
        cursor: pointer;
        touch-action: none;
      }

      /* A bigger invisible hit area, since the visible track is only 4px tall. */
      .volume-track::before {
        content: '';
        position: absolute;
        inset: -0.75rem 0;
      }

      .volume-track.disabled {
        cursor: default;
        opacity: 0.4;
      }

      .volume-fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: 0.125rem;
        background: var(--accent-color);
      }

      .volume-thumb {
        position: absolute;
        top: 50%;
        width: 0.9rem;
        height: 0.9rem;
        border-radius: 50%;
        background: var(--accent-color);
        transform: translate(-50%, -50%);
        box-shadow: 0 0 0 2px var(--card-background-color);
      }

      .cta-button {
        --cta-color: #1db954;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        background: color-mix(in srgb, var(--cta-color) 15%, transparent);
        color: var(--cta-color);
        border: none;
        border-radius: 1rem;
        padding: 0.875rem;
        font-size: var(--sonos-font-size, 1rem);
        font-weight: 600;
        cursor: pointer;
        width: 100%;
      }

      .cta-button ha-svg-icon {
        --mdc-icon-size: 0.95rem;
      }

      .cta-button .cta-logo {
        --mdc-icon-size: 1.3rem;
      }

      /* Compact landscape: the W size (384x188). Must match the query in player-section.styles.ts.
         One evenly spaced row — shuffle, previous, play/pause, next, volume — with smaller buttons; the CTA
         moves to a pill in the header. */
      @container (aspect-ratio > 1) and (max-height: 20rem) {
        :host {
          display: contents;
        }

        .secondary-buttons {
          display: contents;
        }

        .volume-container {
          order: 1;
        }

        .round-button {
          --icon-button-size: 2.3rem;
          --icon-size: 1rem;
        }

        .volume-button {
          --volume-button-size: 2.3rem;
          --volume-icon-size: 1rem;
        }

        .play-pause {
          display: inline-flex;
        }

        .cta-button {
          display: none;
        }
      }
    `;
  }
}

customElements.define('sonos-player-controls', PlayerControls);
