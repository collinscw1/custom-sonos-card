import { css, html, LitElement } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import Store from '../../model/store';
import { styleMap } from 'lit-html/directives/style-map.js';

class PlayerProgress extends LitElement {
  @property({ attribute: false }) store!: Store;

  @state() private playingProgress!: number;
  @state() private dragging = false;
  @state() private dragPercent = 0;
  private tracker?: NodeJS.Timeout;
  @query('.track')
  private trackEl?: HTMLElement;
  private mediaDuration = 0;
  private onPointerMove?: (e: PointerEvent) => void;
  private onPointerUp?: () => void;

  disconnectedCallback() {
    if (this.tracker) {
      clearInterval(this.tracker);
      this.tracker = undefined;
    }
    this.detachDragListeners();
    super.disconnectedCallback();
  }

  render() {
    this.mediaDuration = this.store.activePlayer?.attributes.media_duration || 0;
    const showProgress = this.mediaDuration > 0;
    if (showProgress) {
      this.trackProgress();
    }
    const percent = this.dragging ? this.dragPercent : this.mediaDuration ? Math.min(100, (this.playingProgress / this.mediaDuration) * 100) : 0;
    const displayedPosition = this.dragging ? (percent / 100) * this.mediaDuration : this.playingProgress;
    return html`
      <div class="progress" ?hidden=${!showProgress}>
        <span class="time">${convertProgress(displayedPosition)}</span>
        <div class="track" @pointerdown=${this.handlePointerDown}>
          <div class="fill" style=${styleMap({ width: `${percent}%` })}></div>
          <div class="thumb" style=${styleMap({ left: `${percent}%` })}></div>
        </div>
        <span class="time">${convertProgress(this.mediaDuration - displayedPosition)}</span>
      </div>
    `;
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.updatePercentFromEvent(e);
    this.onPointerMove = (ev: PointerEvent) => this.updatePercentFromEvent(ev);
    this.onPointerUp = () => this.commitSeek();
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  };

  private updatePercentFromEvent(e: PointerEvent) {
    if (!this.trackEl) {
      return;
    }
    const rect = this.trackEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    this.dragPercent = ratio * 100;
  }

  private async commitSeek() {
    const position = (this.dragPercent / 100) * this.mediaDuration;
    this.detachDragListeners();
    this.dragging = false;
    await this.store.mediaControlService.seek(this.store.activePlayer, position);
  }

  private detachDragListeners() {
    if (this.onPointerMove) {
      window.removeEventListener('pointermove', this.onPointerMove);
    }
    if (this.onPointerUp) {
      window.removeEventListener('pointerup', this.onPointerUp);
    }
    this.onPointerMove = undefined;
    this.onPointerUp = undefined;
  }

  trackProgress() {
    const position = this.store.activePlayer?.attributes.media_position || 0;
    const playing = this.store.activePlayer?.isPlaying();
    const updatedAt = this.store.activePlayer?.attributes.media_position_updated_at || 0;
    if (playing) {
      this.playingProgress = position + (Date.now() - new Date(updatedAt).getTime()) / 1000.0;
    } else {
      this.playingProgress = position;
    }
    if (!this.tracker) {
      this.tracker = setInterval(() => this.trackProgress(), 1000);
    }
    if (!playing) {
      clearInterval(this.tracker);
      this.tracker = undefined;
    }
  }

  static get styles() {
    return css`
      .progress {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      [hidden] {
        display: none !important;
      }

      .time {
        font-size: calc(var(--sonos-font-size, 1rem) * 0.85);
        color: var(--secondary-text-color);
        width: 2.5rem;
        flex-shrink: 0;
      }

      .time:last-child {
        text-align: right;
      }

      .track {
        position: relative;
        flex: 1;
        height: 0.25rem;
        background: rgba(var(--rgb-primary-text-color), 0.12);
        border-radius: 0.125rem;
        cursor: pointer;
        touch-action: none;
      }

      .fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: 0.125rem;
        background: var(--accent-color);
      }

      .thumb {
        position: absolute;
        top: 50%;
        width: 1rem;
        height: 1rem;
        border-radius: 50%;
        background: var(--accent-color);
        transform: translate(-50%, -50%);
        box-shadow: 0 0 0 3px var(--card-background-color);
      }

      /* Compact landscape: the W size (384x188). Must match the query in player-section.styles.ts.
         The column is only ~200px wide, so the times drop below the track to give it the full width. */
      @container (aspect-ratio > 1) and (max-height: 20rem) {
        .progress {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-areas:
            'track track'
            'start end';
          row-gap: 0.35rem;
        }

        .track {
          grid-area: track;
        }

        .time {
          width: auto;
          font-size: calc(var(--sonos-font-size, 1rem) * 0.72);
          font-variant-numeric: tabular-nums;
        }

        .time:first-child {
          grid-area: start;
        }

        .time:last-child {
          grid-area: end;
        }

        .thumb {
          width: 0.85rem;
          height: 0.85rem;
          box-shadow: 0 0 0 2px var(--card-background-color);
        }
      }
    `;
  }
}

export const convertProgress = (duration: number): string => {
  if (duration == null || !isFinite(duration)) {
    return '';
  }
  const date = new Date(duration * 1000).toISOString().substring(11, 19);
  const time = date.startsWith('00:') ? date.substring(3) : date;
  return time.replace(/^0(\d)/, '$1');
};

customElements.define('sonos-progress', PlayerProgress);
