import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenTarget } from './screenText.ts';

test('écran du poste : cible réelle de la dernière action', () => {
  assert.equal(screenTarget('read', 'Lit /var/log/nginx/access.log'), 'access.log');
  assert.equal(screenTarget('write', 'Écrit src/office/engine/street.ts'), 'street.ts');
  assert.equal(screenTarget('web', 'Ouvre https://www.robertsspaceindustries.com/comm-link/123'), 'robertsspaceindustries.com');
  assert.equal(screenTarget('web', 'Recherche : patch 4.2 Star Citizen'), '« patch 4.2 Star Citizen »');
  assert.equal(screenTarget('exec', 'Exécute grep -c timeout nginx.log'), '$ grep -c timeout nginx.log');
  assert.equal(screenTarget('exec', 'Exécute une très longue commande avec beaucoup d’options'), '$ une très longue commande av…');
  assert.equal(screenTarget('read', ''), '');
  assert.equal(screenTarget(null, null), '');
});
