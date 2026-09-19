/**
 * The characters bundled with the extension.
 *
 * The list is the runtime source of truth: the popup renders it, the content
 * script validates the stored choice against it. `assets/mascots/animals.json`
 * is the provenance manifest written by scripts/fetch-mascots.mjs and
 * scripts/validate.mjs keeps the two in sync.
 *
 * Written as a classic script (not an ES module) because Chrome does not
 * support `type: module` content scripts. The tiny UMD wrapper below lets the
 * very same file be `require()`d by `node --test`.
 */
(function (root, factory) {
  const api = factory()
  root.MascotCharacters = api
  if (typeof module === 'object' && module.exports) {
    module.exports = api
  }
})(globalThis, function () {
  'use strict'

  // The twenty-one animals drawn by page-mascot, in the order the upstream
  // demo lists them.
  const ANIMALS = [
    { id: 'bear', label: 'Bear' },
    { id: 'bunny', label: 'Bunny' },
    { id: 'cat', label: 'Cat' },
    { id: 'deer', label: 'Deer' },
    { id: 'dino', label: 'Dino' },
    { id: 'fox', label: 'Fox' },
    { id: 'frog', label: 'Frog' },
    { id: 'hamster', label: 'Hamster' },
    { id: 'hedgehog', label: 'Hedgehog' },
    { id: 'koala', label: 'Koala' },
    { id: 'mouse', label: 'Mouse' },
    { id: 'otter', label: 'Otter' },
    { id: 'owl', label: 'Owl' },
    { id: 'panda', label: 'Panda' },
    { id: 'penguin', label: 'Penguin' },
    { id: 'pug', label: 'Pug' },
    { id: 'raccoon', label: 'Raccoon' },
    { id: 'redpanda', label: 'Red panda' },
    { id: 'sheep', label: 'Sheep' },
    { id: 'sloth', label: 'Sloth' },
    { id: 'tiger', label: 'Tiger' },
  ]

  const DEFAULT_CHARACTER = 'fox'

  const MASCOT_DIR = 'assets/mascots'
  const THUMB_DIR = MASCOT_DIR + '/thumbs'

  const INDEX = ANIMALS.reduce(function (map, animal, position) {
    map[animal.id] = { animal: animal, position: position }
    return map
  }, {})

  function ids() {
    return ANIMALS.map(function (animal) {
      return animal.id
    })
  }

  function isAnimal(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(INDEX, id)
  }

  function animal(id) {
    return isAnimal(id) ? INDEX[id].animal : null
  }

  function label(id) {
    const found = animal(id)
    return found ? found.label : animal(DEFAULT_CHARACTER).label
  }

  /** Repo-relative path of a 3x3 atlas. `kind` is 'directions' or 'reactions'. */
  function sheetPath(id, kind) {
    return MASCOT_DIR + '/' + id + '-' + kind + '.webp'
  }

  /** Repo-relative path of the popup thumbnail cropped from the middle cell. */
  function thumbPath(id) {
    return THUMB_DIR + '/' + id + '.webp'
  }

  return {
    ANIMALS: ANIMALS,
    DEFAULT_CHARACTER: DEFAULT_CHARACTER,
    MASCOT_DIR: MASCOT_DIR,
    THUMB_DIR: THUMB_DIR,
    ids: ids,
    isAnimal: isAnimal,
    animal: animal,
    label: label,
    sheetPath: sheetPath,
    thumbPath: thumbPath,
  }
})
