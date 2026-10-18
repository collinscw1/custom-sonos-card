import { css } from 'lit';

export const playerSectionStyles = css`
  :host {
    display: block;
    height: 100%;
    width: 100%;

    /* 'size', not 'inline-size'. The layout branches on aspect-ratio and the
       artwork is sized from cqh; both need full size containment, which
       inline-size does not provide (a height or aspect query under
       inline-size silently never matches).

       Safe wherever HA gives the card a definite height: Sections with a
       numeric grid_options.rows, or a configured \`height\`. The min-height is
       the safety net for Masonry, where the height is indefinite (see the
       comment on haCardStyle in card.ts) and size containment would otherwise
       collapse the card to zero. */
    container-type: size;
    min-height: 12rem;
  }

  .container {
    display: flex;
    height: 100%;
  }

  /* Stacked is the DEFAULT, and landscape is the exception below. A square or
     portrait box is the constrained case, so it gets the base rule. */
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 1rem;
    width: 100%;
    height: 100%;
    background: var(--card-background-color);
    border-radius: 2rem;
    box-shadow: var(--ha-card-box-shadow, 0 20px 60px -20px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.04));
    padding: 1.25rem;
    box-sizing: border-box;
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
  }

  .card[background] {
    background-color: var(--background-overlay-color, rgba(var(--rgb-card-background-color), var(--background-opacity, 0.9)));
  }

  .card.blurred-background {
    background-color: transparent;
    isolation: isolate;
    overflow: hidden;
  }

  .card.blurred-background::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image: var(--blur-background-image);
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
    filter: blur(var(--blur-amount));
    transform: scale(1.1);
    z-index: -1;
  }

  /* Sized from whichever container dimension runs out first, so the art stays
     square and always fits, at every size, with no per-size rules.

     Deliberately NO max-width / max-height here: when both axes are
     constrained, aspect-ratio loses and the box distorts. min() with container
     units is the combination that holds the ratio.

     The subtracted rems are the card's own padding, which cq units don't
     account for. Keep them in step with .card's padding. */
  .artwork {
    aspect-ratio: 1 / 1;
    height: auto;
    width: min(100cqw - 2.5rem, 55cqh);
    flex: none;
    align-self: center;
    border-radius: 1.125rem;
    overflow: hidden;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    position: relative;
  }

  .info {
    flex: 1;
    min-width: 0;
    /* Lets the info column shrink instead of pushing the card past its box. */
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1rem;
  }

  [hidden] {
    display: none !important;
  }

  /* Branch on SHAPE, not width.

     The previous rule here was \`@container (max-width: 30rem)\`, which cannot
     work in a grid that varies both axes: W (384x188) and L (384x384) are the
     same width and completely different shapes. It stacked both, and stacking
     a 384px-wide box makes the square artwork 384px tall — taller than W's
     whole box, and the entirety of L's. */
  @container (aspect-ratio > 1) {
    .card {
      flex-direction: row;
      padding: 1.75rem;
      gap: 1.5rem;
    }

    .artwork {
      width: min(45cqw, 100cqh - 3.5rem);
    }

    .info {
      gap: 1.5rem;
    }
  }

  /* Compact landscape: short AND wide, i.e. the W size, not XL/XW (384px+ tall), which keep the roomier rule
     above. Shape plus height, never width alone: W and L share a width.

     20rem (280px) covers W on the tablet theme (188px tall) and on stock HA rows (~248px, e.g. a desktop
     browser without the tablet theme). 17rem missed the stock case by 8px and fell back to the old layout.

     The header and controls go display: contents in this mode (same query in player-header.ts,
     player-controls.ts and player-progress.ts — keep all four in step), so .info spaces the four rows
     itself: switcher, titles, progress, buttons.

     Height budget at 188px: 164px inside the padding; rows total ~125px, the rest is spacing. */
  @container (aspect-ratio > 1) and (max-height: 20rem) {
    .card {
      padding: 0.875rem;
      gap: 0.875rem;
    }

    /* 34cqw = ~130px at 384 wide; 100cqh minus the vertical padding keeps it inside a short box. */
    .artwork {
      width: min(34cqw, 100cqh - 1.75rem);
      border-radius: 1rem;
    }

    .info {
      justify-content: space-between;
      gap: 0;
    }
  }
`;
