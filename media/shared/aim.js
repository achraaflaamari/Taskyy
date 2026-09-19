/**
 * Where the aiming maths lives: eight sectors around the mascot, a dead zone so
 * the head settles when the pointer is close, and hysteresis so it does not
 * flicker when the pointer sits on a sector boundary.
 *
 * The constants are the upstream ones, so the extension behaves exactly like
 * the `<Mascot />` component on a page.
 */
(function (root, factory) {
  const sprite = typeof require === 'function' ? require('../shared/sprite.js') : root.MascotSprite
  const api = factory(sprite)
  root.MascotAim = api
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
})(globalThis, function (sprite) {
  'use strict'

  /** Clockwise from the right, matching atan2 with y pointing down. */
  const CLOCKWISE = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right']
  const SECTOR = (Math.PI * 2) / CLOCKWISE.length
  const HYSTERESIS = 0.12
  const DEAD_ZONE = 70

  function wrap(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle))
  }

  function sectorFor(angle) {
    return (Math.round(angle / SECTOR) + CLOCKWISE.length) % CLOCKWISE.length
  }

  /**
   * Returns the direction for an offset from the middle of the mascot, keeping
   * the previous sector while the pointer is still inside it plus HYSTERESIS.
   */
  function nextDirection(previousSector, dx, dy) {
    if (Math.hypot(dx, dy) < DEAD_ZONE) {
      return { sector: -1, direction: sprite.CENTER }
    }
    const angle = Math.atan2(dy, dx)
    if (
      previousSector !== -1 &&
      Math.abs(wrap(angle - previousSector * SECTOR)) < SECTOR / 2 + HYSTERESIS
    ) {
      return { sector: previousSector, direction: CLOCKWISE[previousSector] }
    }
    const sector = sectorFor(angle)
    return { sector: sector, direction: CLOCKWISE[sector] }
  }

  /** Stateful wrapper: remembers the held sector between pointer events. */
  function createAimer() {
    let sector = -1
    let direction = sprite.CENTER

    function settle(next) {
      const changed = next !== direction
      direction = next
      return { direction: direction, changed: changed }
    }

    return {
      get direction() {
        return direction
      },
      reset: function () {
        sector = -1
        return settle(sprite.CENTER)
      },
      /**
       * @param {number} dx horizontal offset from the middle of the mascot
       * @param {number} dy vertical offset from the middle of the mascot
       */
      update: function (dx, dy) {
        const result = nextDirection(sector, dx, dy)
        sector = result.sector
        return settle(result.direction)
      },
    }
  }

  return {
    CLOCKWISE: CLOCKWISE,
    SECTOR: SECTOR,
    HYSTERESIS: HYSTERESIS,
    DEAD_ZONE: DEAD_ZONE,
    wrap: wrap,
    sectorFor: sectorFor,
    nextDirection: nextDirection,
    createAimer: createAimer,
  }
})
