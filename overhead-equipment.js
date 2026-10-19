/* Overhead equipment guide and local equipment profile. This module is loaded only when a reader asks
   for the guide or the profile; it is presentation plus form parsing, with no network, storage or
   astronomy of its own. The page supplies storage and the difficulty module supplies the taxonomy. */
(function (root) {
'use strict';

var GUIDE = [
  {
    id: 'naked-eye', title: 'Naked eye',
    paragraphs: [
      'Your eyes are the best wide-field instrument for meteors, bright satellites, the Milky Way band under dark skies and the brightest planets and comets.',
      'Give yourself at least 20 minutes away from white light. A red headlamp preserves dark adaptation; a phone screen at full brightness destroys it. The Moon and local light pollution raise the sky background and can erase a faint target even when the geometry is perfect.'
    ],
    bullets: ['Best for: bright passes, meteor showers, the Milky Way band, bright planets, lunar eclipses.',
      'Not enough for: faint comets, small planetary detail, most galaxies and nebulae.'],
  },
  {
    id: 'binoculars', title: 'Binoculars',
    paragraphs: [
      'Numbers such as 7×50 and 10×50 mean magnification × objective diameter in millimetres. The objective sets light gathering; the magnification sets how large and how steady the view feels.',
      'Lower magnification gives a wider field and is easier to hold steady. Higher magnification shows more detail but magnifies hand shake; a tripod or a supported view helps. Binoculars show the Moon, bright planets as small discs, star clusters, large comets and the brighter Milky Way star clouds.'
    ],
    bullets: ['Best for: wide-field scanning, star clusters, the Moon, bright comets, learning the sky.',
      'Limits: a faint, diffuse comet can be invisible even when a star chart says it is above the horizon; binoculars are not a substitute for aperture and dark skies.'],
  },
  {
    id: 'telescopes', title: 'Visual telescopes',
    paragraphs: [
      'Aperture is the main light-gathering number. A 130–150 mm reflector or refractor is a common first visual telescope; a 200 mm instrument collects more light and can show fainter diffuse objects, but it is heavier and needs a stable mount.',
      'Focal length and focal ratio set the field of view and the magnification with a given eyepiece. A short, fast telescope frames wide fields; a long focal length makes planets and the Moon larger. Magnification is changed with eyepieces, and a very high magnification that the atmosphere cannot support shows an enlarged but empty image.',
      'A manual mount rewards patience and star-hopping. A computerized mount finds objects after alignment but still needs a power source and a little setup. A tracking mount follows the sky; it does not make a faint object brighter.'
    ],
    bullets: ['Best for: planets, the Moon, double stars, brighter clusters and nebulae, brighter comets.',
      'Limits: a telescope sees a narrow field, so it is the wrong instrument for a whole-sky meteor watch or a wide Milky Way landscape.'],
  },
];
GUIDE.push(
  {
    id: 'smart', title: 'Smart telescopes',
    paragraphs: [
      'A smart telescope aligns and points itself, tracks the sky and builds an image by stacking many short exposures. You usually watch on a phone or tablet rather than through an eyepiece.',
      'Its small aperture and short focal length suit wide nebulae, galaxies and faint comets as imaging targets. It is less suited to fine planetary detail, which needs a larger aperture and a different imaging technique.'
    ],
    bullets: ['Best for: imaging nebulae, galaxies and faint comets; simple setup.',
      'Limits: the result is a processed image, not a visual eyepiece view; small aperture limits resolution.'],
  },
  {
    id: 'cameras', title: 'DSLR or mirrorless camera',
    paragraphs: [
      'A camera and a wide lens on a stable tripod are the standard beginner Milky Way landscape kit. A 14–35 mm full-frame equivalent field, a fast aperture and short exposures are a practical starting point; the exact exposure depends on the lens, sensor and sky brightness.',
      'A star tracker lets you expose longer without trailing. For smaller deep-sky targets, a longer lens or a small telescope on a tracking mount is needed, and the mount and alignment become as important as the camera.'
    ],
    bullets: ['Best for: Milky Way landscapes, meteor trails, constellation and wide-field images.',
      'Limits: a single short exposure rarely reaches a faint comet or galaxy; stacking and tracking are separate skills.'],
  },
  {
    id: 'advanced', title: 'Advanced imaging',
    paragraphs: [
      'An equatorial mount, guided exposures, a cooled camera and image stacking are the usual next steps for faint deep-sky work. The mount carries the weight and follows the sky; guiding corrects small tracking errors; stacking improves the signal-to-noise ratio.',
      'Filters have specific purposes: light-pollution filters can help some emission targets but are not a substitute for dark skies, and solar filters are mandatory for any solar observation. Processing is part of the technique, not a way to recover detail that was never recorded.'
    ],
    bullets: ['Best for: faint comets, galaxies, emission nebulae and long-integration projects.',
      'Limits: cost, weight, setup time and a steep learning curve. A bigger telescope does not fix a poor mount or a bright sky.'],
  }
);


function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function guideHTML() {
  return '<section class="equipment-guide" aria-labelledby="equipment-guide-title">' +
    '<h2 id="equipment-guide-title">Choosing equipment for the night sky</h2>' +
    '<p class="small">A short guide to what different instruments do well. It is not a buying guide, and it does not promise that a particular object will be visible.</p>' +
    '<div class="equipment-guide-grid">' + GUIDE.map(function (section) {
      return '<article class="equipment-guide-card"><h3>' + esc(section.title) + '</h3>' +
        section.paragraphs.map(function (text) { return '<p>' + esc(text) + '</p>'; }).join('') +
        '<ul class="small">' + section.bullets.map(function (text) { return '<li>' + esc(text) + '</li>'; }).join('') + '</ul></article>';
    }).join('') + '</div>' +
    '<div class="equipment-guide-note"><h3>How the two difficulty labels differ</h3>' +
    '<p><strong>Visual difficulty</strong> describes what a person at the eyepiece or under the sky is likely to need. <strong>Imaging difficulty</strong> describes a camera technique; a target can be very hard to see and still be recorded by a camera that collects light for longer.</p>' +
    '<p class="small">These are Worth Looking Up’s own conservative tiers, not an astronomical standard and not a limiting-magnitude calculation. The observing-suitability score beside an opportunity describes the conditions and geometry; it is a separate answer.</p></div>' +
    '</section>';
}
function checkbox(name, checked, label, note) {
  return '<label class="equipment-check"><input type="checkbox" name="' + esc(name) + '"' + (checked ? ' checked' : '') + '>' +
    '<span><strong>' + esc(label) + '</strong>' + (note ? '<span class="small"> — ' + esc(note) + '</span>' : '') + '</span></label>';
}
function field(name, label, value, attrs) {
  return '<label><span>' + esc(label) + '</span><input name="' + esc(name) + '" value="' + esc(value === null || value === undefined ? '' : value) + '" ' + (attrs || '') + '></label>';
}


function profileHTML(profile) {
  var p = root.OverheadDifficulty ? root.OverheadDifficulty.normaliseProfile(profile) : { types: {}, binoculars: {}, telescope: {}, camera: {} };
  var t = p.types || {}, b = p.binoculars || {}, s = p.telescope || {}, c = p.camera || {};
  var sensor = c.sensor || '';
  var option = function (value, label) { return '<option value="' + esc(value) + '"' + (sensor === value ? ' selected' : '') + '>' + esc(label) + '</option>'; };
  return '<section class="equipment-profile" aria-labelledby="equipment-profile-title">' +
    '<h2 id="equipment-profile-title">My equipment</h2>' +
    '<p class="small">Tell the app what you have, in your own words and numbers. Everything is optional and nothing is uploaded. This is user-reported capability, not a calibrated performance specification.</p>' +
    '<form id="equipment-form" class="equipment-form" novalidate>' +
    '<fieldset><legend>What do you have?</legend><div class="equipment-checks">' +
      checkbox('types.nakedEye', t.nakedEye, 'Naked eye', 'always available; useful to record') +
      checkbox('types.binoculars', t.binoculars, 'Binoculars') +
      checkbox('types.telescope', t.telescope, 'Visual telescope') +
      checkbox('types.smartTelescope', t.smartTelescope, 'Smart telescope') +
      checkbox('types.camera', t.camera, 'DSLR or mirrorless camera') +
      checkbox('types.trackedImaging', t.trackedImaging, 'Tracked camera imaging', 'a mount that follows the sky') +
      checkbox('types.advancedImaging', t.advancedImaging, 'Advanced guided imaging', 'equatorial mount, guiding and stacking') +
    '</div></fieldset>' +
    '<div class="equipment-grid">' +
      '<fieldset><legend>Binoculars</legend><div class="equipment-grid">' +
        field('binoculars.magnification', 'Magnification (×)', b.magnification, 'type="number" min="1" max="60" step="1" inputmode="numeric"') +
        field('binoculars.objectiveMm', 'Objective diameter (mm)', b.objectiveMm, 'type="number" min="10" max="250" step="1" inputmode="numeric"') +
      '</div><p class="small">For example 10×50: magnification 10, objective 50 mm.</p></fieldset>' +
      '<fieldset><legend>Visual telescope</legend>' + field('telescope.apertureMm', 'Aperture (mm)', s.apertureMm, 'type="number" min="20" max="1500" step="1" inputmode="numeric"') +
        '<p class="small">A 130–150 mm telescope is a common first instrument; 200 mm and above is a larger visual telescope.</p></fieldset>' +
      '<fieldset><legend>Camera</legend><div class="equipment-grid">' +
        '<label><span>Sensor format</span><select name="camera.sensor">' +
          '<option value="">Not given</option>' + option('full-frame', 'Full frame') + option('aps-c', 'APS-C') +
          option('micro-four-thirds', 'Micro four thirds') + option('unknown', 'Not sure') + '</select></label>' +
        field('camera.focalLengthMm', 'Lens focal length (mm)', c.focalLengthMm, 'type="number" min="1" max="5000" step="1" inputmode="numeric"') +
        field('camera.aperture', 'Maximum aperture (f/)', c.aperture, 'type="number" min="0.7" max="32" step="0.1" inputmode="decimal"') +
        checkbox('camera.tracking', c.tracking === true, 'I have a tracking mount for this camera') +
      '</div></fieldset>' +
    '</div>' +
    '<p class="small">Saved only in this browser. Clearing site data removes it. No account, model, serial number or purchase history is requested.</p>' +
    '<div class="actions"><button type="submit" class="primary">Save my equipment</button>' +
      '<button type="button" data-equipment-reset>Reset</button></div>' +
    '<p class="small equipment-status" role="status"></p>' +
    '</form></section>';
}


function clearValue(value) { return value === '' || value === null || value === undefined ? null : value; }
function readForm(form, normalise) {
  var data = new FormData(form);
  var get = function (name) { var value = data.get(name); return value === null ? '' : String(value); };
  var checked = function (name) { return data.get(name) !== null; };
  var value = function (name) { return clearValue(get(name)); };
  var raw = {
    types: {
      nakedEye: checked('types.nakedEye'), binoculars: checked('types.binoculars'), telescope: checked('types.telescope'),
      smartTelescope: checked('types.smartTelescope'), camera: checked('types.camera'),
      trackedImaging: checked('types.trackedImaging'), advancedImaging: checked('types.advancedImaging'),
    },
    binoculars: { magnification: value('binoculars.magnification'), objectiveMm: value('binoculars.objectiveMm') },
    telescope: { apertureMm: value('telescope.apertureMm') },
    camera: { sensor: value('camera.sensor'), focalLengthMm: value('camera.focalLengthMm'),
      aperture: value('camera.aperture'), tracking: checked('camera.tracking') },
    updatedAt: Date.now(),
  };
  return normalise(raw);
}
function renderGuide() { return guideHTML(); }
function renderProfile(profile) { return profileHTML(profile); }
root.OverheadEquipment = { GUIDE: GUIDE, renderGuide: renderGuide, renderProfile: renderProfile, readForm: readForm };
if (typeof module !== 'undefined') module.exports = root.OverheadEquipment;
})(typeof self !== 'undefined' ? self : globalThis);

