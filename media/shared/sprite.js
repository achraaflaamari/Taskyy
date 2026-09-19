/**
 * Geometry of a page-mascot character: two 3x3 atlases, nine cells each.
 *
 * Shared by the content script (the mascot on the page) and the popup (the
 * animal thumbnails), so the cell order only ever lives here.
 */
(function (root, factory) {
  const api = factory()
  root.MascotSprite = api
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
})(globalThis, function () {
  'use strict'

  const COLUMNS = 3
  const ROWS = 3
  const CELLS = COLUMNS * ROWS

  /** Cell order of the directions sheet, reading left to right, top to bottom. */
  const DIRECTIONS = [
    'up-left',
    'up',
    'up-right',
    'left',
    'center',
    'right',
    'down-left',
    'down',
    'down-right',
  ]

  /**
   * Cell order of the reactions sheet. These are the upstream names; cell 0 is
   * the closed-eye happy face and cell 4 is the starry-eyed one.
   */
  const REACTIONS = [
    'blink',
    'heart',
    'sparkle',
    'surprised',
    'starstruck',
    'bashful',
    'sleepy',
    'dizzy',
    'delighted',
  ]

  const CENTER = 'center'

  function indexOf(list, value) {
    const found = list.indexOf(value)
    return found === -1 ? 0 : found
  }

  function directionIndex(direction) {
    return indexOf(DIRECTIONS, direction)
  }

  function reactionIndex(reaction) {
    return indexOf(REACTIONS, reaction)
  }

  function isReaction(name) {
    return REACTIONS.indexOf(name) !== -1
  }

  function isDirection(name) {
    return DIRECTIONS.indexOf(name) !== -1
  }

  /**
   * A `background-position` value for one cell of a sheet painted at
   * `background-size: 300% 300%` -- the 0 / 50 / 100 percent steps.
   */
  function positionOf(cell) {
    const bounded = ((Math.trunc(cell) % CELLS) + CELLS) % CELLS
    const x = (bounded % COLUMNS) * (100 / (COLUMNS - 1))
    const y = Math.floor(bounded / COLUMNS) * (100 / (ROWS - 1))
    return x + '% ' + y + '%'
  }

  return {
    COLUMNS: COLUMNS,
    ROWS: ROWS,
    CELLS: CELLS,
    DIRECTIONS: DIRECTIONS,
    REACTIONS: REACTIONS,
    CENTER: CENTER,
    directionIndex: directionIndex,
    reactionIndex: reactionIndex,
    isReaction: isReaction,
    isDirection: isDirection,
    positionOf: positionOf,
  }
})
