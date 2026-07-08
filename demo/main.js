// Entry point: build both columns, wire everything, boot both instruments.
import { $ } from './state.js';
import { colHTML, wireCard, wireHeader } from './ui.js';
import { rebuild, reSyncAll, updateReadouts } from './engine.js';

$('#stage').innerHTML = colHTML(0) + colHTML(1);
wireCard(0);
wireCard(1);
wireHeader();
rebuild(0);
rebuild(1);
reSyncAll();

// Live "window / drawn / last value" readouts.
setInterval(updateReadouts, 120);
